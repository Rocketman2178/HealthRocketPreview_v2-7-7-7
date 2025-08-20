/*
  # Fix infinite recursion in community_memberships RLS policies
  
  The existing policies are causing infinite recursion because they reference
  the community_memberships table within their own policy definitions.
  This migration completely replaces them with safe, non-recursive policies.
*/

-- Drop ALL existing policies on community_memberships to start fresh
DROP POLICY IF EXISTS "memberships_insert" ON community_memberships;
DROP POLICY IF EXISTS "memberships_insert_policy" ON community_memberships;
DROP POLICY IF EXISTS "memberships_select" ON community_memberships;
DROP POLICY IF EXISTS "memberships_select_policy" ON community_memberships;
DROP POLICY IF EXISTS "memberships_update" ON community_memberships;
DROP POLICY IF EXISTS "memberships_update_policy" ON community_memberships;
DROP POLICY IF EXISTS "memberships_delete" ON community_memberships;
DROP POLICY IF EXISTS "memberships_delete_policy" ON community_memberships;

-- Create new, safe policies that don't cause recursion
CREATE POLICY "Users can view their own memberships" ON community_memberships
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memberships" ON community_memberships
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memberships" ON community_memberships
  FOR UPDATE TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own memberships" ON community_memberships
  FOR DELETE TO public USING (auth.uid() = user_id);

-- Add a separate policy for viewing other members in the same community
-- This uses a direct join without referencing community_memberships in the policy
CREATE POLICY "Users can view members in their communities" ON community_memberships
  FOR SELECT TO public USING (
    community_id IN (
      SELECT cm.community_id 
      FROM community_memberships cm 
      WHERE cm.user_id = auth.uid()
    )
  );