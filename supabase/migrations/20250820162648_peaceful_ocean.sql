/*
  # Remove Community Chat Tables

  This migration removes community chat functionality while preserving core community infrastructure needed for:
  1. Community memberships and leaderboards
  2. Contest/Challenge chat functionality  
  3. Community competition features

  ## Tables Being Removed
  - `community_chat_messages` - Community-wide chat messages
  - `community_chat_mentions` - User mentions in community chat
  - `community_message_reactions` - Reactions to community messages

  ## Tables Being Preserved
  - `communities` - Core community data for leaderboards
  - `community_memberships` - User memberships for leaderboard participation
  - `chat_messages` - Contest/Challenge specific chat (different from community chat)
  - `message_reactions` - Contest/Challenge chat reactions
  - All other community-related tables for competitions and leaderboards

  ## Edge Functions Being Removed
  - `community-chat` - Community chat message handling
  - `community-operations` - Community chat operations
  
  Note: Contest/Challenge chat functionality uses different tables and remains intact.
*/

-- Remove community chat tables (preserving core community infrastructure)
DROP TABLE IF EXISTS community_chat_mentions CASCADE;
DROP TABLE IF EXISTS community_message_reactions CASCADE;
DROP TABLE IF EXISTS community_chat_messages CASCADE;

-- Note: We keep these tables for leaderboards and contests:
-- - communities (needed for leaderboard grouping)
-- - community_memberships (needed for leaderboard participation)
-- - chat_messages (used for contest/challenge chat, not community chat)
-- - message_reactions (used for contest/challenge chat reactions)