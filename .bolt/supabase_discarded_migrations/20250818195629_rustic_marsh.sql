/*
  # Community Chat Foundation - Database Schema
  
  1. New Tables
    - `community_chat_messages` - Dedicated table for community chat messages
    - `community_chat_mentions` - Track @mentions and notifications
  
  2. Security
    - Enable RLS on both tables
    - Community members can view/send messages in their communities
    - Users can only delete their own messages
    - Users can view mentions directed at them
  
  3. Functions
    - Extract mentioned users from message content
    - Handle mention creation automatically
    - Update reply counts
    - Get unread mention counts
    - Mark mentions as read
    - Get community chat messages with user details
*/

-- ============================================================================
-- COMMUNITY CHAT FEATURE - NEW TABLES
-- ============================================================================

-- Drop existing policies if they exist to avoid conflicts
DO $$ 
BEGIN
  -- Drop policies for community_chat_messages if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'community_chat_messages') THEN
    DROP POLICY IF EXISTS "Community members can view messages" ON community_chat_messages;
    DROP POLICY IF EXISTS "Community members can insert messages" ON community_chat_messages;
    DROP POLICY IF EXISTS "Users can delete own messages" ON community_chat_messages;
    DROP POLICY IF EXISTS "Users can update own messages" ON community_chat_messages;
  END IF;
  
  -- Drop policies for community_chat_mentions if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'community_chat_mentions') THEN
    DROP POLICY IF EXISTS "Users can view mentions for themselves" ON community_chat_mentions;
    DROP POLICY IF EXISTS "Users can insert mentions" ON community_chat_mentions;
    DROP POLICY IF EXISTS "Users can update their own mention read status" ON community_chat_mentions;
  END IF;
END $$;

/*
  # Community Chat Messages - New dedicated table
  
  Dedicated table for community chat messages (separate from contest chat)
*/
CREATE TABLE IF NOT EXISTS community_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video')),
  parent_message_id UUID REFERENCES community_chat_messages(id) ON DELETE SET NULL,
  reply_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  user_name TEXT DEFAULT '',
  
  -- Ensure content is not empty
  CONSTRAINT content_not_empty CHECK (char_length(trim(content)) > 0 OR media_url IS NOT NULL)
);

-- Enable RLS
ALTER TABLE community_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Community members can view messages" ON community_chat_messages
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM community_memberships 
      WHERE community_id = community_chat_messages.community_id 
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Community members can insert messages" ON community_chat_messages
  FOR INSERT TO public WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM community_memberships 
      WHERE community_id = community_chat_messages.community_id 
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own messages" ON community_chat_messages
  FOR DELETE TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can update own messages" ON community_chat_messages
  FOR UPDATE TO public USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_community_chat_messages_community_id ON community_chat_messages (community_id);
CREATE INDEX IF NOT EXISTS idx_community_chat_messages_user_id ON community_chat_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_community_chat_messages_created_at ON community_chat_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_chat_messages_parent_id ON community_chat_messages (parent_message_id);

/*
  # Community Chat Mentions - User mention tracking
*/
CREATE TABLE IF NOT EXISTS community_chat_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES community_chat_messages(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioning_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'community_chat_mentions_message_id_mentioned_user_id_key'
    AND table_name = 'community_chat_mentions'
  ) THEN
    ALTER TABLE community_chat_mentions ADD CONSTRAINT community_chat_mentions_message_id_mentioned_user_id_key UNIQUE (message_id, mentioned_user_id);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE community_chat_mentions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view mentions for themselves" ON community_chat_mentions
  FOR SELECT TO public USING (auth.uid() = mentioned_user_id);

CREATE POLICY "Users can insert mentions" ON community_chat_mentions
  FOR INSERT TO public WITH CHECK (auth.uid() = mentioning_user_id);

CREATE POLICY "Users can update their own mention read status" ON community_chat_mentions
  FOR UPDATE TO public USING (auth.uid() = mentioned_user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_community_chat_mentions_mentioned_user ON community_chat_mentions (mentioned_user_id);
CREATE INDEX IF NOT EXISTS idx_community_chat_mentions_community ON community_chat_mentions (community_id);
CREATE INDEX IF NOT EXISTS idx_community_chat_mentions_unread ON community_chat_mentions (mentioned_user_id) WHERE is_read = false;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

/*
  # Function to extract mentioned users from message content
*/
CREATE OR REPLACE FUNCTION extract_mentioned_users_community(p_content TEXT, p_community_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  mentioned_users UUID[] := '{}';
  username_match TEXT;
  user_id UUID;
  mention_matches TEXT[];
BEGIN
  -- Extract all @username patterns from content using a simpler approach
  SELECT array_agg(substring(word FROM 2)) INTO mention_matches
  FROM unnest(string_to_array(p_content, ' ')) AS word
  WHERE word ~ '^@\w+';
  
  -- Process each mention
  IF mention_matches IS NOT NULL THEN
    FOREACH username_match IN ARRAY mention_matches
    LOOP
      -- Find user by name within the community
      SELECT u.id INTO user_id
      FROM users u
      JOIN community_memberships cm ON cm.user_id = u.id
      WHERE LOWER(u.name) = LOWER(username_match)
      AND cm.community_id = p_community_id;
      
      IF user_id IS NOT NULL THEN
        mentioned_users := array_append(mentioned_users, user_id);
      END IF;
    END LOOP;
  END IF;
  
  RETURN mentioned_users;
END;
$$;

/*
  # Function to handle community chat mentions
*/
CREATE OR REPLACE FUNCTION handle_community_chat_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  mentioned_user_ids UUID[];
  mentioned_user_id UUID;
BEGIN
  -- Extract mentioned users from content
  mentioned_user_ids := extract_mentioned_users_community(NEW.content, NEW.community_id);
  
  -- Create mention records
  FOREACH mentioned_user_id IN ARRAY mentioned_user_ids
  LOOP
    -- Don't create self-mentions
    IF mentioned_user_id != NEW.user_id THEN
      INSERT INTO community_chat_mentions (
        message_id,
        mentioned_user_id,
        mentioning_user_id,
        community_id
      ) VALUES (
        NEW.id,
        mentioned_user_id,
        NEW.user_id,
        NEW.community_id
      ) ON CONFLICT (message_id, mentioned_user_id) DO NOTHING;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS handle_community_chat_mentions_trigger ON community_chat_messages;

-- Create trigger for handling mentions
CREATE TRIGGER handle_community_chat_mentions_trigger
  AFTER INSERT ON community_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION handle_community_chat_mentions();

/*
  # Function to update reply count
*/
CREATE OR REPLACE FUNCTION update_community_chat_reply_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_message_id IS NOT NULL THEN
    UPDATE community_chat_messages 
    SET reply_count = reply_count + 1 
    WHERE id = NEW.parent_message_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_message_id IS NOT NULL THEN
    UPDATE community_chat_messages 
    SET reply_count = GREATEST(reply_count - 1, 0)
    WHERE id = OLD.parent_message_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_community_chat_reply_count_trigger ON community_chat_messages;

-- Create trigger for reply count updates
CREATE TRIGGER update_community_chat_reply_count_trigger
  AFTER INSERT OR DELETE ON community_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_community_chat_reply_count();

-- ============================================================================
-- UTILITY FUNCTIONS FOR FRONTEND
-- ============================================================================

/*
  # Get unread mention count for user
*/
CREATE OR REPLACE FUNCTION get_community_unread_mention_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  count INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO count
  FROM community_chat_mentions
  WHERE mentioned_user_id = p_user_id
  AND is_read = false;
  
  RETURN count;
END;
$$;

/*
  # Mark mentions as read for user in community
*/
CREATE OR REPLACE FUNCTION mark_community_chat_mentions_read(
  p_user_id UUID, 
  p_community_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE community_chat_mentions
  SET is_read = true
  WHERE mentioned_user_id = p_user_id
  AND community_id = p_community_id
  AND is_read = false;
  
  RETURN true;
END;
$$;

/*
  # Get community chat messages with user details
*/
CREATE OR REPLACE FUNCTION get_community_chat_messages(
  p_community_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  community_id UUID,
  user_id UUID,
  content TEXT,
  media_url TEXT,
  media_type TEXT,
  parent_message_id UUID,
  reply_count INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_name TEXT,
  user_avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ccm.id,
    ccm.community_id,
    ccm.user_id,
    ccm.content,
    ccm.media_url,
    ccm.media_type,
    ccm.parent_message_id,
    ccm.reply_count,
    ccm.created_at,
    ccm.updated_at,
    COALESCE(u.name, '') as user_name,
    u.avatar_url as user_avatar_url
  FROM community_chat_messages ccm
  LEFT JOIN users u ON u.id = ccm.user_id
  WHERE ccm.community_id = p_community_id
  ORDER BY ccm.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;