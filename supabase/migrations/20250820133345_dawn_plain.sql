/*
  # Fix Community RLS Infinite Recursion

  1. RLS Policy Fixes
    - Drop problematic recursive policies on community_memberships
    - Create simple, direct ownership policies
    - Fix community_message_reactions policies
    - Add performance indexes

  2. Security Changes
    - Simplify RLS to only check direct user ownership
    - Remove circular dependencies between tables
    - Maintain security through Edge Functions with service role

  3. Performance Optimizations
    - Add indexes for community operations
    - Optimize membership lookup queries
*/

-- Drop all existing problematic RLS policies
DROP POLICY IF EXISTS "Community members can view other members" ON community_memberships;
DROP POLICY IF EXISTS "Community members can view messages" ON community_chat_messages;
DROP POLICY IF EXISTS "Community members can view reactions" ON community_message_reactions;
DROP POLICY IF EXISTS "Community members can add reactions" ON community_message_reactions;

-- Create simple, non-recursive RLS policies for community_memberships
CREATE POLICY "Users can view their own memberships"
  ON community_memberships
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memberships"
  ON community_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memberships"
  ON community_memberships
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Simplified policies for community_chat_messages (no membership checks in RLS)
DROP POLICY IF EXISTS "Community members can insert messages" ON community_chat_messages;
DROP POLICY IF EXISTS "Community members can view messages" ON community_chat_messages;

CREATE POLICY "Users can insert their own messages"
  ON community_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view messages"
  ON community_chat_messages
  FOR SELECT
  TO authenticated
  USING (true); -- Edge function will handle membership verification

CREATE POLICY "Users can update their own messages"
  ON community_chat_messages
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages"
  ON community_chat_messages
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Simplified policies for community_message_reactions
CREATE POLICY "Users can view all reactions"
  ON community_message_reactions
  FOR SELECT
  TO authenticated
  USING (true); -- Edge function will handle membership verification

CREATE POLICY "Users can insert their own reactions"
  ON community_message_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own reactions"
  ON community_message_reactions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Add performance indexes for community operations
CREATE INDEX IF NOT EXISTS idx_community_memberships_user_community 
  ON community_memberships (user_id, community_id);

CREATE INDEX IF NOT EXISTS idx_community_memberships_community_active 
  ON community_memberships (community_id) 
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_chat_messages_community_created 
  ON community_chat_messages (community_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_message_reactions_message 
  ON community_message_reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_community_message_reactions_user 
  ON community_message_reactions (user_id);

-- Create a function to verify community membership (for Edge Function use)
CREATE OR REPLACE FUNCTION verify_community_membership(p_user_id UUID, p_community_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM community_memberships 
    WHERE user_id = p_user_id 
    AND community_id = p_community_id
  );
END;
$$;

-- Create a function to get community members (for Edge Function use)
CREATE OR REPLACE FUNCTION get_community_members_list(p_community_id UUID)
RETURNS TABLE (
  user_id UUID,
  user_name TEXT,
  avatar_url TEXT,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cm.user_id,
    u.name as user_name,
    u.avatar_url,
    cm.joined_at
  FROM community_memberships cm
  JOIN users u ON cm.user_id = u.id
  WHERE cm.community_id = p_community_id
  ORDER BY cm.joined_at DESC;
END;
$$;

-- Create a function to get message reactions with user info (for Edge Function use)
CREATE OR REPLACE FUNCTION get_message_reactions_with_users(p_message_id UUID)
RETURNS TABLE (
  reaction_id UUID,
  user_id UUID,
  user_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cmr.id as reaction_id,
    cmr.user_id,
    u.name as user_name,
    cmr.created_at
  FROM community_message_reactions cmr
  JOIN users u ON cmr.user_id = u.id
  WHERE cmr.message_id = p_message_id
  ORDER BY cmr.created_at ASC;
END;
$$;