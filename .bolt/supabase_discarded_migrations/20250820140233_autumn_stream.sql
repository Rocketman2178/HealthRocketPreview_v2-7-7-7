/*
  # Fix Community RLS Infinite Recursion

  1. Policy Updates
    - Drop all existing problematic RLS policies safely
    - Create simple, non-recursive policies for community tables
    - Focus on direct ownership checks only

  2. Helper Functions
    - Add functions for Edge Functions to use with SECURITY DEFINER
    - Bypass RLS for complex operations safely

  3. Performance Indexes
    - Add indexes for community operations
    - Optimize membership lookups
*/

-- Drop existing problematic policies safely
DROP POLICY IF EXISTS "users_own_memberships_select" ON community_memberships;
DROP POLICY IF EXISTS "users_own_memberships_insert" ON community_memberships;
DROP POLICY IF EXISTS "users_own_memberships_update" ON community_memberships;
DROP POLICY IF EXISTS "Users can view their own memberships" ON community_memberships;
DROP POLICY IF EXISTS "Users can insert their own memberships" ON community_memberships;
DROP POLICY IF EXISTS "Users can update their own memberships" ON community_memberships;

DROP POLICY IF EXISTS "users_own_reactions_select" ON community_message_reactions;
DROP POLICY IF EXISTS "users_own_reactions_insert" ON community_message_reactions;
DROP POLICY IF EXISTS "users_own_reactions_delete" ON community_message_reactions;

-- Create simple, direct ownership policies for community_memberships
CREATE POLICY "Simple membership select"
  ON community_memberships
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Simple membership insert"
  ON community_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Simple membership update"
  ON community_memberships
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create simple policies for community_message_reactions
CREATE POLICY "Simple reaction select"
  ON community_message_reactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Simple reaction insert"
  ON community_message_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Simple reaction delete"
  ON community_message_reactions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Helper function to verify community membership (bypasses RLS)
CREATE OR REPLACE FUNCTION verify_community_membership(p_user_id uuid, p_community_id uuid)
RETURNS boolean
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

-- Helper function to get community members (bypasses RLS)
CREATE OR REPLACE FUNCTION get_community_members_list(p_community_id uuid)
RETURNS TABLE (
  user_id uuid,
  user_name text,
  avatar_url text,
  joined_at timestamptz
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
  JOIN users u ON u.id = cm.user_id
  WHERE cm.community_id = p_community_id
  ORDER BY cm.joined_at DESC;
END;
$$;

-- Helper function to get message reactions with user info (bypasses RLS)
CREATE OR REPLACE FUNCTION get_message_reactions_with_users(p_message_id uuid)
RETURNS TABLE (
  reaction_id uuid,
  user_id uuid,
  user_name text,
  created_at timestamptz
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
  JOIN users u ON u.id = cmr.user_id
  WHERE cmr.message_id = p_message_id
  ORDER BY cmr.created_at ASC;
END;
$$;

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_community_memberships_user_community 
  ON community_memberships (user_id, community_id);

CREATE INDEX IF NOT EXISTS idx_community_message_reactions_message_user 
  ON community_message_reactions (message_id, user_id);

CREATE INDEX IF NOT EXISTS idx_community_chat_messages_community_created 
  ON community_chat_messages (community_id, created_at DESC);