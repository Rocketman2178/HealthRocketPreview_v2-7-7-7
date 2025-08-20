import { useState, useEffect } from 'react';
import { CommunityChatService } from '../lib/chat/CommunityChatService';
import { useSupabase } from '../contexts/SupabaseContext';
import { useCommunity } from './useCommunity';

export function useCommunityChat() {
  const { user } = useSupabase();
  const { primaryCommunity } = useCommunity(user?.id);
  const [unreadMentions, setUnreadMentions] = useState(0);
  const [loading, setLoading] = useState(true);

  // Load unread mention count
  useEffect(() => {
    if (!user) {
      setUnreadMentions(0);
      setLoading(false);
      return;
    }

    const loadUnreadCount = async () => {
      try {
        const count = await CommunityChatService.getUnreadMentionCount(user.id);
        setUnreadMentions(count);
      } catch (err) {
        console.error('Error loading unread mentions:', err);
        setUnreadMentions(0);
      } finally {
        setLoading(false);
      }
    };

    loadUnreadCount();

    // Refresh count every 30 seconds
    const interval = setInterval(loadUnreadCount, 30000);
    
    return () => clearInterval(interval);
  }, [user]);

  // Mark mentions as read for current community
  const markMentionsAsRead = async () => {
    if (!user || !primaryCommunity) return;
    
    try {
      await CommunityChatService.markMentionsAsRead(user.id, primaryCommunity.id);
      setUnreadMentions(0);
    } catch (err) {
      console.error('Error marking mentions as read:', err);
    }
  };

  return {
    unreadMentions,
    loading,
    markMentionsAsRead,
    refreshUnreadCount: () => {
      if (user) {
        CommunityChatService.getUnreadMentionCount(user.id)
          .then(setUnreadMentions)
          .catch(console.error);
      }
    }
  };
}