export interface CommunityOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CommunityOperationError extends Error {
  retryable?: boolean;
}

export interface MessageReactionData {
  id: string;
  message_id: string;
  user_id: string;
  created_at: string;
}

export interface CommunityMemberData {
  id: string;
  user_id: string;
  community_id: string;
  user_name: string;
  joined_at: string;
  is_primary: boolean;
  global_leaderboard_opt_in: boolean;
  settings: {
    role: string;
  };
}

export interface Community {
  id: string;
  name: string;
  description?: string;
  member_count: number;
  settings: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommunityMessage {
  id: string;
  community_id: string;
  user_id: string;
  content: string;
  media_url?: string;
  media_type?: string;
  parent_message_id?: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
  user_name: string;
  parentMessage?: {
    id: string;
    content: string;
    user_name: string;
    created_at: string;
  };
}