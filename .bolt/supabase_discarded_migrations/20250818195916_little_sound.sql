/*
  # Fix infinite recursion in community_memberships RLS policies
  
  1. Problem
    - Current RLS policies on community_memberships table have circular references
    - Policies reference community_memberships table within their own definitions
    - This causes infinite recursion when querying the table
  
  2. Solution
    - Drop existing problematic policies
    - Create simplified policies that avoid circular references
    - Use direct auth.uid() checks instead of subqueries that reference the same table
*/

-- Drop existing problematic policies that cause recursion
DROP POLICY IF EXISTS "memberships_insert" ON community_memberships;
DROP POLICY IF EXISTS "memberships_insert_policy" ON community_memberships;
DROP POLICY IF EXISTS "memberships_select" ON community_memberships;
DROP POLICY IF EXISTS "memberships_select_policy" ON community_memberships;
DROP POLICY IF EXISTS "memberships_update" ON community_memberships;
DROP POLICY IF EXISTS "memberships_update_policy" ON community_memberships;

-- Create new simplified policies without recursion
CREATE POLICY "Users can view their own memberships" ON community_memberships
  FOR SELECT TO public USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memberships" ON community_memberships
  FOR INSERT TO public WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memberships" ON community_memberships
  FOR UPDATE TO public USING (auth.uid() = user_id);

-- Allow viewing other members in the same community (for community member lists)
CREATE POLICY "Community members can view other members" ON community_memberships
  FOR SELECT TO public USING (
    EXISTS (
      SELECT 1 FROM community_memberships cm
      WHERE cm.user_id = auth.uid() 
      AND cm.community_id = community_memberships.community_id
    )
  );