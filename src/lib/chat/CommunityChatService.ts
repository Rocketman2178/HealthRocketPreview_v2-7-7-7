import { supabase } from '../supabase';
import { DatabaseError } from '../errors';

export interface CommunityMessage {
  id: string;
  communityId: string;
  userId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  parentMessageId?: string;
  replyCount: number;
  createdAt: Date;
  updatedAt: Date;
  userName: string;
  userAvatarUrl?: string;
}

export interface CommunityMention {
  id: string;
  messageId: string;
  mentionedUserId: string;
  mentioningUserId: string;
  communityId: string;
  isRead: boolean;
  createdAt: Date;
}

export class CommunityChatService {
  /**
   * Get messages for a community
   */
  static async getMessages(
    communityId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<CommunityMessage[]> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('User not authenticated');
      }

      // Create abort controller for 10-second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-chat?action=get_messages&community_id=${communityId}&limit=${limit}&offset=${offset}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch messages');
      }

      return data.messages?.map((msg: any) => ({
        id: msg.id,
        communityId: msg.community_id,
        userId: msg.user_id,
        content: msg.content,
        mediaUrl: msg.media_url,
        mediaType: msg.media_type,
        parentMessageId: msg.parent_message_id,
        replyCount: msg.reply_count || 0,
        createdAt: new Date(msg.created_at),
        updatedAt: new Date(msg.updated_at),
        userName: msg.user_name,
        userAvatarUrl: msg.user_avatar_url
      })) || [];
    } catch (err) {
      console.error('Error fetching community messages:', err);
      throw new DatabaseError('Failed to fetch messages');
    }
  }

  /**
   * Send a message to community chat using edge function
   */
  static async sendMessage(
    userId: string,
    communityId: string,
    content: string,
    mediaFile?: File,
    parentMessageId?: string
  ): Promise<CommunityMessage> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('User not authenticated');
      }

      let mediaPublicUrl: string | null = null;
      let mediaType: 'image' | 'video' | null = null;

      // Handle media upload
      if (mediaFile) {
        const fileExt = mediaFile.name.split('.').pop()?.toLowerCase();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `community-chat-media/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(filePath, mediaFile);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from('chat-media')
          .getPublicUrl(filePath);

        mediaPublicUrl = data.publicUrl;
        mediaType = mediaFile.type.startsWith('video/') ? 'video' : 'image';
      }

      // Send message via edge function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-chat?action=send_message`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            communityId,
            content,
            mediaUrl: mediaPublicUrl,
            mediaType,
            parentMessageId
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to send message');
      }

      return {
        id: data.message.id,
        communityId: data.message.community_id,
        userId: data.message.user_id,
        content: data.message.content,
        mediaUrl: data.message.media_url,
        mediaType: data.message.media_type,
        parentMessageId: data.message.parent_message_id,
        replyCount: data.message.reply_count || 0,
        createdAt: new Date(data.message.created_at),
        updatedAt: new Date(data.message.updated_at),
        userName: data.message.user_name || '',
        userAvatarUrl: data.message.user_avatar_url
      };
    } catch (err) {
      console.error('Error sending message:', err);
      throw new DatabaseError('Failed to send message');
    }
  }

  /**
   * Delete a message using edge function
   */
  static async deleteMessage(userId: string, messageId: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-chat?action=delete_message`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messageId })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete message');
      }

    } catch (err) {
      console.error('Error deleting message:', err);
      throw new DatabaseError('Failed to delete message');
    }
  }

  /**
   * Subscribe to new messages in community (deprecated - use direct Supabase subscription)
   */
  static subscribeToMessages(
    communityId: string,
    onNewMessage: (message: CommunityMessage) => void,
    onDeletedMessage: (messageId: string) => void
  ): { unsubscribe: () => void } {
    const subscription = supabase
      .channel(`community_chat_${communityId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'community_chat_messages',
          filter: `community_id=eq.${communityId}`
        },
        (payload) => {
          const message: CommunityMessage = {
            id: payload.new.id,
            communityId: payload.new.community_id,
            userId: payload.new.user_id,
            content: payload.new.content,
            mediaUrl: payload.new.media_url,
            mediaType: payload.new.media_type,
            parentMessageId: payload.new.parent_message_id,
            replyCount: payload.new.reply_count || 0,
            createdAt: new Date(payload.new.created_at),
            updatedAt: new Date(payload.new.updated_at),
            userName: payload.new.user_name || 'Unknown User',
            userAvatarUrl: undefined
          };
          onNewMessage(message);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'community_chat_messages',
          filter: `community_id=eq.${communityId}`
        },
        (payload) => {
          onDeletedMessage(payload.old.id);
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(subscription);
      }
    };
  }

  /**
   * Get unread mention count
   */
  static async getUnreadMentionCount(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .rpc('get_community_unread_mention_count', { p_user_id: userId });
      
      if (error) throw error;
      return data || 0;
    } catch (err) {
      console.error('Error getting unread mention count:', err);
      return 0;
    }
  }

  /**
   * Mark mentions as read in community
   */
  static async markMentionsAsRead(userId: string, communityId: string): Promise<void> {
    try {
      const { error } = await supabase
        .rpc('mark_community_chat_mentions_read', {
          p_user_id: userId,
          p_community_id: communityId
        });
      
      if (error) throw error;
    } catch (err) {
      console.error('Error marking mentions as read:', err);
      throw new DatabaseError('Failed to mark mentions as read');
    }
  }

  /**
   * Toggle reaction on a community message
   */
  static async toggleReaction(userId: string, messageId: string): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-operations?operation=toggle_reaction`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messageId })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to toggle reaction');
      }
      
      return data.reaction_added;
    } catch (err) {
      console.error('Error toggling community message reaction:', err);
      throw new DatabaseError('Failed to toggle reaction');
    }
  }

  /**
   * Get reactions for a community message
   */
  static async getMessageReactions(messageId: string): Promise<Array<{
    id: string;
    user_id: string;
    user_name: string;
    created_at: string;
  }>> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-operations?operation=get_message_reactions&message_id=${messageId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch message reactions');
      }

      return data.reactions?.map((reaction: any) => ({
        id: reaction.reaction_id,
        user_id: reaction.user_id,
        user_name: reaction.user_name,
        created_at: reaction.created_at
      })) || [];
    } catch (err) {
      console.error('Error fetching community message reactions:', err);
      throw new DatabaseError('Failed to fetch message reactions');
    }
  }

  /**
   * Get community members using edge function
   */
  static async getCommunityMembers(communityId: string): Promise<Array<{
    id: string;
    name: string;
    avatarUrl?: string;
  }>> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-operations?operation=get_members&community_id=${communityId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch members');
      }

      return data.members?.map((member: any) => ({
        id: member.user_id,
        name: member.user_name,
        avatarUrl: member.avatar_url
      })) || [];
    } catch (err) {
      console.error('Error fetching community members:', err);
      throw new DatabaseError('Failed to fetch community members');
    }
  }

  /**
   * Verify if user is a member of a community using new Edge Function
   */
  static async verifyCommunityMembership(userId: string, communityId: string): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-operations?operation=verify_membership&community_id=${communityId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      return data.is_member || false;
    } catch (err) {
      console.error('Error verifying community membership:', err);
      return false;
    }
  }
}