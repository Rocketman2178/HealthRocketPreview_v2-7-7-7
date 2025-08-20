import { supabase } from '../supabase';
import type { CommunityMessage } from '../../types/community';

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
      const { data, error } = await supabase.rpc('get_community_chat_messages', {
        p_community_id: communityId,
        p_limit: limit,
        p_offset: offset
      });

      if (error) throw error;

      // Transform and sort messages oldest first (proper chat order)
      const messages = (data || []).map((msg: any) => ({
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
        userName: msg.user_name || 'Unknown User',
        userAvatarUrl: msg.user_avatar_url
      }));

      // Sort oldest first for proper chat flow
      return messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    } catch (err) {
      console.error('Error fetching community messages:', err);
      throw err;
    }
  }

  /**
   * Send a message to a community
   */
  static async sendMessage(
    userId: string,
    communityId: string,
    content: string,
    mediaUrl?: string,
    mediaType?: 'image' | 'video',
    parentMessageId?: string
  ): Promise<CommunityMessage> {
    try {
      // Get user details first
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('name, avatar_url')
        .eq('id', userId)
        .single();

      if (userError) throw userError;

      // Insert message directly
      const { data, error } = await supabase
        .from('community_chat_messages')
        .insert({
          user_id: userId,
          community_id: communityId,
          content: content.trim(),
          media_url: mediaUrl,
          media_type: mediaType,
          parent_message_id: parentMessageId,
          user_name: userData.name || 'Unknown User'
        })
        .select('*')
        .single();

      if (error) throw error;

      return {
        id: data.id,
        communityId: data.community_id,
        userId: data.user_id,
        content: data.content,
        mediaUrl: data.media_url,
        mediaType: data.media_type,
        parentMessageId: data.parent_message_id,
        replyCount: data.reply_count || 0,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        userName: userData.name || 'Unknown User',
        userAvatarUrl: userData.avatar_url
      };
    } catch (err) {
      console.error('Error sending community message:', err);
      throw err;
    }
  }

  /**
   * Delete a message
   */
  static async deleteMessage(userId: string, messageId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('community_chat_messages')
        .delete()
        .eq('id', messageId)
        .eq('user_id', userId);

      if (error) throw error;
    } catch (err) {
      console.error('Error deleting community message:', err);
      throw err;
    }
  }

  /**
   * Toggle reaction on a message
   */
  static async toggleReaction(userId: string, messageId: string): Promise<boolean> {
    try {
      // Check if user already reacted
      const { data: existingReaction, error: checkError } = await supabase
        .from('community_message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingReaction) {
        // Remove reaction
        const { error: deleteError } = await supabase
          .from('community_message_reactions')
          .delete()
          .eq('id', existingReaction.id);

        if (deleteError) throw deleteError;
        return false; // Reaction removed
      } else {
        // Add reaction
        const { error: insertError } = await supabase
          .from('community_message_reactions')
          .insert({
            message_id: messageId,
            user_id: userId
          });

        if (insertError) throw insertError;
        return true; // Reaction added
      }
    } catch (err) {
      console.error('Error toggling reaction:', err);
      throw err;
    }
  }

  /**
   * Get reactions for a message
   */
  static async getMessageReactions(messageId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('community_message_reactions')
        .select(`
          id,
          user_id,
          created_at,
          users:user_id (
            name
          )
        `)
        .eq('message_id', messageId);

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching message reactions:', err);
      throw err;
    }
  }

  /**
   * Subscribe to real-time message updates
   */
  static subscribeToMessages(
    communityId: string,
    onNewMessage: (message: CommunityMessage) => void,
    onDeletedMessage: (messageId: string) => void
  ) {
    const channel = supabase
      .channel(`community_chat_${communityId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'community_chat_messages',
          filter: `community_id=eq.${communityId}`
        },
        async (payload) => {
          try {
            // Get user details for the new message
            const { data: userData, error: userError } = await supabase
              .from('users')
              .select('name, avatar_url')
              .eq('id', payload.new.user_id)
              .single();

            if (userError) {
              console.warn('Could not fetch user data for new message:', userError);
            }

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
              userName: userData?.name || payload.new.user_name || 'Unknown User',
              userAvatarUrl: userData?.avatar_url
            };

            onNewMessage(message);
          } catch (err) {
            console.error('Error processing new message:', err);
          }
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
        supabase.removeChannel(channel);
      }
    };
  }

  /**
   * Get community members for mentions
   */
  static async getCommunityMembers(communityId: string): Promise<Array<{id: string; name: string; avatarUrl?: string}>> {
    try {
      const { data, error } = await supabase.rpc('get_community_members_list', {
        p_community_id: communityId
      });

      if (error) throw error;

      return (data || []).map((member: any) => ({
        id: member.user_id,
        name: member.user_name || 'Unknown User',
        avatarUrl: member.avatar_url
      }));
    } catch (err) {
      console.error('Error fetching community members:', err);
      return [];
    }
  }

  /**
   * Get unread mention count for a user
   */
  static async getUnreadMentionCount(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('community_chat_mentions')
        .select('id')
        .eq('mentioned_user_id', userId)
        .eq('is_read', false);

      if (error) throw error;
      return data?.length || 0;
    } catch (err) {
      console.error('Error fetching unread mention count:', err);
      return 0;
    }
  }

  /**
   * Mark mentions as read for a community
   */
  static async markMentionsAsRead(userId: string, communityId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('community_chat_mentions')
        .update({ is_read: true })
        .eq('mentioned_user_id', userId)
        .eq('community_id', communityId);

      if (error) throw error;
    } catch (err) {
      console.error('Error marking mentions as read:', err);
      throw err;
    }
  }
}