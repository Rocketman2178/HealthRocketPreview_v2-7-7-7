import { useState, useCallback, useRef } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
    const startTime = Date.now();
import { CommunityAnalytics } from '../lib/monitoring/CommunityAnalytics';
import { CommunityCache } from '../lib/cache/CommunityCache';
import { CommunityAnalytics } from '../lib/monitoring/CommunityAnalytics';
import { CommunityCache } from '../lib/cache/CommunityCache';
import type { 
  CommunityOperationResult, 
  MessageReactionData, 
  CommunityMemberData,
  CommunityOperationError 
} from '../types/community';


export function useCommunityOperations() {
  const { user } = useSupabase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CommunityOperationError | null>(null);
  
  // Generic Edge Function caller with retry logic
  const callEdgeFunction = useCallback(async <T>(
    operation: string,
    params: Record<string, any> = {},
    method: 'GET' | 'POST' = 'GET',
    maxRetries: number = 3
  ): Promise<CommunityOperationResult<T>> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }
    
    const startTime = Date.now();
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('No active session');
        }
        
        // Build URL with query params for GET requests
        const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/community-operations`);
        url.searchParams.set('operation', operation);
        
        if (method === 'GET') {
          Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              url.searchParams.set(key, String(value));
            }
          });
        }
        
        const requestOptions: RequestInit = {
          method,
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
  const handleEmojiClick = (emojiData: any) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const handleMentionDetection = (content: string) => {
    // Simple @ mention detection - could be enhanced later
    const mentionRegex = /@(\w+)/g;
    return content.replace(mentionRegex, '<span class="text-orange-500 font-bold">@$1</span>');
  };
          // Add timeout
          signal: AbortSignal.timeout(10000)
        };
        
        if (method === 'POST') {
          requestOptions.body = JSON.stringify(params);
        }
        
        const response = await fetch(url.toString(), requestOptions);
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
    <Card className="flex flex-col h-[500px]">
        const data = await response.json();
        
        if (!data.success) {
          const error = new Error(data.error || 'Operation failed') as CommunityOperationError;
          error.retryable = response.status >= 500; // Server errors are retryable
          throw error;
        }
        
        // Track successful operation
        CommunityAnalytics.trackPerformance(
          operation,
          startTime,
          true,
          undefined,
          user.id,
          params.community_id
        );
        
        // Track successful operation
        CommunityAnalytics.trackPerformance(
          operation,
          startTime,
          true,
          undefined,
          user.id,
          params.community_id
        );
        
        return { success: true, data: data };
      } catch (err) {
        lastError = err as Error;
        
        // Don't retry on client errors (4xx) or authentication errors
        if (err instanceof Error) {
          const isRetryable = (err as CommunityOperationError).retryable !== false &&
                             !err.message.includes('authentication') &&
                             !err.message.includes('not a member');
          
          if (!isRetryable || attempt === maxRetries - 1) {
            break;
          }
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Track failed operation
    CommunityAnalytics.trackPerformance(
      operation,
      startTime,
      false,
      lastError?.message,
      user.id,
      params.community_id
    );
              const isReply = !!message.parentMessageId;
              const parentMessage = isReply ? messages.find(m => m.id === message.parentMessageId) : null;
    
    // Track failed operation
    CommunityAnalytics.trackPerformance(
      operation,
      startTime,
      false,
                  {/* Show parent message if this is a reply */}
                  {isReply && parentMessage && (
                    <div className={`mb-2 ml-4 ${isMyMessage ? 'mr-8' : 'ml-12'}`}>
                      <div className="bg-gray-600/30 border-l-2 border-orange-500/50 pl-3 py-2 rounded-r-lg">
                        <div className="text-xs text-orange-500 font-medium mb-1">
                          Replying to {parentMessage.userName}
                        </div>
                        <div className="text-xs text-gray-400 truncate">
                          {parentMessage.content.substring(0, 100)}...
                        </div>
                      </div>
                    </div>
                  )}
                  
      lastError?.message,
      user.id,
      params.community_id
    );
    
    return { 
      success: false, 
      error: lastError?.message || 'Operation failed after retries' 
    };
  }, [user]);
  
  // Verify community membership with caching
  const verifyCommunityMembership = useCallback(async (
    communityId: string
  ): Promise<CommunityOperationResult<boolean>> => {
    const cacheKey = `membership_${user?.id}_${communityId}`;
    const cached = CommunityCache.get<boolean>(cacheKey);
    
    if (cached !== null) {
      return { success: true, data: cached };
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await callEdgeFunction<{ is_member: boolean }>(
        'verify_membership',
        { community_id: communityId }
      );
      
      if (result.success && result.data) {
        const isMember = result.data.is_member;
        CommunityCache.set(cacheKey, isMember);
        return { success: true, data: isMember };
                          <div 
                            className="text-sm"
                            dangerouslySetInnerHTML={{
                              __html: handleMentionDetection(message.content)
                            }}
                          />
      
      return result;
    } catch (err) {
      messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
      const error = err as CommunityOperationError;
      setError(error);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, [user?.id, callEdgeFunction]);
  
  // Get community members with caching
  const getCommunityMembers = useCallback(async (
    communityId: string
  ): Promise<CommunityOperationResult<CommunityMemberData[]>> => {
    const cacheKey = `members_${communityId}`;
    const cached = CommunityCache.get<CommunityMemberData[]>(cacheKey);
    
    if (cached !== null) {
      CommunityAnalytics.trackCache(cacheKey, true);
      return { success: true, data: cached };
    }
    
    CommunityAnalytics.trackCache(cacheKey, false);
    setLoading(true);
    setError(null);
    
    try {
      const result = await callEdgeFunction<{ members: CommunityMemberData[] }>(
                            <div className="flex items-center gap-2">
        { community_id: communityId }
      );
      
      if (result.success && result.data) {
        const members = result.data.members || [];
        CommunityCache.set(cacheKey, members);
        return { success: true, data: members };
      }
      
      return result;
    } catch (err) {
      const error = err as CommunityOperationError;
      setError(error);
      return { success: false, error: error.message };
    } finally {
                                      ? 'text-orange-500 hover:text-orange-400' 
                                      : 'text-gray-400 hover:text-orange-500'
  }, [callEdgeFunction]);
  
  // Get message reactions
                                  <Zap size={14} fill={hasReacted ? 'currentColor' : 'none'} />
    messageId: string
  ): Promise<CommunityOperationResult<MessageReactionData[]>> => {
    const cacheKey = `reactions_${messageId}`;
    const cached = CommunityCache.get<MessageReactionData[]>(cacheKey);
    
    if (cached !== null) {
      CommunityAnalytics.trackCache(cacheKey, true);
      return { success: true, data: cached };
    }
    
    CommunityAnalytics.trackCache(cacheKey, false);
    setLoading(true);
    setError(null);
    
    try {
      const result = await callEdgeFunction<{ reactions: MessageReactionData[] }>(
        'get_message_reactions',
        { message_id: messageId }
      );
                              <Zap size={12} className="text-orange-500" />
      if (result.success && result.data) {
        const reactions = result.data.reactions || [];
        CommunityCache.set(cacheKey, reactions, 2 * 60 * 1000); // 2 minute cache for reactions
        return { success: true, data: reactions };
      }
      const sentMessage = await CommunityChatService.sendMessage(
      
    } catch (err) {
      const error = err as CommunityOperationError;
      setError(error);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
      // Add message immediately to UI for instant feedback
  }, [callEdgeFunction]);
      if (sentMessage) {
  
        setMessages(prev => [...prev, sentMessage]);
        {/* Emoji Picker */}
        {showEmojiPicker && (
          <div ref={emojiPickerRef} className="absolute bottom-full mb-2 right-4 z-50">
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              theme="dark"
              width={300}
              height={400}
            />
          </div>
        )}
        
  // Toggle message reaction
          {/* Emoji button */}
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-2 text-gray-400 hover:text-orange-500 transition-colors"
            title="Add emoji"
          >
            <Smile size={20} />
          </button>
          
        // Scroll to bottom immediately
  const toggleMessageReaction = useCallback(async (
        setTimeout(() => {
    messageId: string
          if (messagesEndRef.current) {
  ): Promise<CommunityOperationResult<{ reaction_added: boolean }>> => {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    setLoading(true);
          }
    setError(null);
        }, 50);
    
      }
    try {

      const result = await callEdgeFunction<{ reaction_added: boolean }>(
        'toggle_reaction',
    error,
    verifyCommunityMembership,
    getCommunityMembers,
    getMessageReactions,
    toggleMessageReaction,
    clearCache
  };
}