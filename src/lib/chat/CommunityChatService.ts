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
   * Get messages for a community using direct RPC call
   */
  static async getMessages(
    communityId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<CommunityMessage[]> {
    try {
      // Use direct RPC call instead of edge function to avoid AbortError
      const { data, error } = await supabase.rpc('get_community_chat_messages', {
        p_community_id: communityId,
        p_limit: limit,
        p_offset: offset
      });

      if (error) throw error;

      // Transform and sort messages OLDEST FIRST for proper chat order
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

      // Sort oldest first (proper chat order)
      return messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    } catch (err) {
      console.error('Error fetching community messages:', err);
      throw new DatabaseError('Failed to fetch messages');
    }
  }

  /**
   * Send a message using direct Supabase insert
   */
  static async sendMessage(
    userId: string,
    communityId: string,
    content: string,
    mediaFile?: File,
    parentMessageId?: string
  ): Promise<CommunityMessage> {
    try {
      let mediaPublicUrl: string | null = null;
      let mediaType: 'image' | 'video' | null = null;

      // Handle media upload if provided
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

      // Get user name for the message
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('name, avatar_url')
        .eq('id', userId)
        .single();

      if (userError) throw userError;

      // Insert message directly into database
      const { data: newMessage, error: insertError } = await supabase
        .from('community_chat_messages')
        .insert({
          user_id: userId,
          community_id: communityId,
          content: content.trim(),
          media_url: mediaPublicUrl,
          media_type: mediaType,
          parent_message_id: parentMessageId,
          user_name: userData.name || 'Unknown User'
        })
        .select(`
          id,
          community_id,
          user_id,
          content,
          media_url,
          media_type,
          parent_message_id,
          reply_count,
          created_at,
          updated_at,
          user_name
        `)
        .single();

      if (insertError) throw insertError;

      return {
        id: newMessage.id,
        communityId: newMessage.community_id,
        userId: newMessage.user_id,
        content: newMessage.content,
        mediaUrl: newMessage.media_url,
        mediaType: newMessage.media_type,
        parentMessageId: newMessage.parent_message_id,
        replyCount: newMessage.reply_count || 0,
        createdAt: new Date(newMessage.created_at),
        updatedAt: new Date(newMessage.updated_at),
        userName: newMessage.user_name,
        userAvatarUrl: userData.avatar_url
      };
    } catch (err) {
      console.error('Error sending message:', err);
      throw new DatabaseError('Failed to send message');
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
        .eq('user_id', userId); // Users can only delete their own messages

      if (error) throw error;
    } catch (err) {
      console.error('Error deleting message:', err);
      throw new DatabaseError('Failed to delete message');
    }
  }

  /**
   * Subscribe to new messages with proper cleanup
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
   * Toggle reaction on a community message
   */
  static async toggleReaction(userId: string, messageId: string): Promise<boolean> {
    try {
      // Check if user already reacted to this message
      const { data: existingReaction, error: checkError } = await supabase
        .from('community_message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .maybeSingle();

      if (checkError) throw checkError;

      // If user already reacted, remove the reaction (toggle behavior)
      if (existingReaction) {
        const { error: deleteError } = await supabase
          .from('community_message_reactions')
          .delete()
          .eq('id', existingReaction.id);

        if (deleteError) throw deleteError;
        return false; // Reaction removed
      }

      // Otherwise, add a new reaction
      const { error: insertError } = await supabase
        .from('community_message_reactions')
        .insert({
          message_id: messageId,
          user_id: userId
        });

      if (insertError) throw insertError;
      return true; // Reaction added
    } catch (err) {
      console.error('Error toggling reaction:', err);
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
      const { data, error } = await supabase
        .from('community_message_reactions')
        .select(`
          id,
          message_id,
          user_id,
          created_at,
          users:user_id (
            name
          )
        `)
        .eq('message_id', messageId);

      if (error) throw error;
      
      return (data || []).map((reaction: any) => ({
        id: reaction.id,
        user_id: reaction.user_id,
        user_name: reaction.users?.name || 'Unknown User',
        created_at: reaction.created_at
      }));
    } catch (err) {
      console.error('Error fetching message reactions:', err);
      throw new DatabaseError('Failed to fetch message reactions');
    }
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
   * Get community members
   */
  static async getCommunityMembers(communityId: string): Promise<Array<{
    id: string;
    name: string;
    avatarUrl?: string;
  }>> {
    try {
      const { data, error } = await supabase
        .rpc('get_community_members_list', {
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
      throw new DatabaseError('Failed to fetch community members');
    }
  }

  /**
   * Verify if user is a member of a community
   */
  static async verifyCommunityMembership(userId: string, communityId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('verify_community_membership', {
          p_user_id: userId,
          p_community_id: communityId
        });

      if (error) throw error;
      return !!data;
    } catch (err) {
      console.error('Error verifying community membership:', err);
      return false;
    }
  }
}