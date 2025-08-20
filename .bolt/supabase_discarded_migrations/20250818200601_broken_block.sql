/*
  # Drop problematic community RLS policies

  This migration removes the RLS policies that are causing infinite recursion
  on the community_memberships table. This is the first step to resolve the
  circular dependency issue.

  1. Policy Removal
    - Drop all existing policies on community_memberships table
    - These policies were causing infinite recursion when accessing community data

  2. Safety
    - Only drops policies, doesn't modify table structure
    - Prepares for clean policy recreation in next migration
*/

-- Drop all existing policies on community_memberships that cause recursion
DROP POLICY IF EXISTS "memberships_insert" ON community_memberships;
DROP POLICY IF EXISTS "memberships_insert_policy" ON community_memberships;
DROP POLICY IF EXISTS "memberships_select" ON community_memberships;
DROP POLICY IF EXISTS "memberships_select_policy" ON community_memberships;
DROP POLICY IF EXISTS "memberships_update" ON community_memberships;
DROP POLICY IF EXISTS "memberships_update_policy" ON community_memberships;

-- Drop any other policies that might exist
DROP POLICY IF EXISTS "Community members can view memberships" ON community_memberships;
DROP POLICY IF EXISTS "Users can manage own membership" ON community_memberships;
DROP POLICY IF EXISTS "Users can view community members" ON community_memberships;