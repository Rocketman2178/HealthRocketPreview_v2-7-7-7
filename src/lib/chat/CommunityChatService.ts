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
    
    // Track failed operation
    CommunityAnalytics.trackPerformance(
      operation,
      startTime,
      false,
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
      }
      
      return result;
    } catch (err) {
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
        'get_members',
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
      setLoading(false);
    }
  }, [callEdgeFunction]);
  
  // Get message reactions
  const getMessageReactions = useCallback(async (
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
      
      if (result.success && result.data) {
        const reactions = result.data.reactions || [];
        CommunityCache.set(cacheKey, reactions, 2 * 60 * 1000); // 2 minute cache for reactions
        return { success: true, data: reactions };
      }
      
      return result;
    } catch (err) {
      const error = err as CommunityOperationError;
      setError(error);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  }, [callEdgeFunction]);
  
  // Toggle message reaction
  const toggleMessageReaction = useCallback(async (
    messageId: string
  ): Promise<CommunityOperationResult<{ reaction_added: boolean }>> => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await callEdgeFunction<{ reaction_added: boolean }>(
        'toggle_reaction',
      )
    }
    error,
    verifyCommunityMembership,
    getCommunityMembers,
    getMessageReactions,
    toggleMessageReaction,
    clearCache
  };
  )
}