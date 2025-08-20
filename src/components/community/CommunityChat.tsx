import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageCircle, 
  Users, 
  AtSign,
  ChevronDown,
  AlertCircle,
  User
} from 'lucide-react';
import { useSupabase } from '../../contexts/SupabaseContext';
import { useCommunity } from '../../hooks/useCommunity';
import { useCommunityOperations } from '../../hooks/useCommunityOperations';
import { ChatMessage } from '../chat/ChatMessage';
import { EnhancedChatInput } from './EnhancedChatInput';
import { CommunityChatService, type CommunityMessage } from '../../lib/chat/CommunityChatService';
import type { ChatMessage as ChatMessageType } from '../../types/chat';

interface CommunityChatProps {
  onError?: (error: string) => void;
}

export function CommunityChat({ onError }: CommunityChatProps) {
  const { user } = useSupabase();
  const { primaryCommunity, loading: communityLoading } = useCommunity(user?.id);
  const { 
    loading: operationsLoading, 
    error: operationsError,
    getCommunityMembers,
    getMessageReactions,
    toggleMessageReaction,
    clearCache
  } = useCommunityOperations();
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [members, setMembers] = useState<Array<{id: string; name: string; avatarUrl?: string}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  const [unreadMentions, setUnreadMentions] = useState(0);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const [messageReactions, setMessageReactions] = useState<Map<string, any[]>>(new Map());
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load community members
  useEffect(() => {
    if (!primaryCommunity) return;

    const loadMembers = async (retryAttempt = 0) => {
      try {
        const result = await getCommunityMembers(primaryCommunity.id);
        
        if (result.success && result.data) {
          const memberList = result.data.map(member => ({
            id: member.user_id,
            name: member.user_name,
            avatarUrl: member.avatar_url
          }));
          setMembers(memberList);
          setRetryCount(0); // Reset retry count on success
        } else {
          throw new Error(result.error || 'Failed to load members');
        }
      } catch (err) {
        console.error('Error loading members:', err);
        
        // Retry logic for member loading
        if (retryAttempt < 2) {
          setTimeout(() => {
            loadMembers(retryAttempt + 1);
          }, 1000 * (retryAttempt + 1));
        } else {
          onError?.('Failed to load community members after multiple attempts');
        }
      }
    };

    loadMembers();
  }, [primaryCommunity, getCommunityMembers, onError]);

  // Load messages and set up real-time subscription
  useEffect(() => {
    if (!primaryCommunity || !user) return;

    const loadMessages = async (retryAttempt = 0) => {
      try {
        setLoading(true);
        setIsRetrying(retryAttempt > 0);
        const chatMessages = await CommunityChatService.getMessages(primaryCommunity.id);
        setMessages(chatMessages.reverse()); // Reverse to show oldest first
        
        // Store the latest message ID for polling comparison
        if (chatMessages.length > 0) {
          lastMessageIdRef.current = chatMessages[chatMessages.length - 1].id;
        }
        
        // Mark mentions as read when viewing chat
        await CommunityChatService.markMentionsAsRead(user.id, primaryCommunity.id);
        setUnreadMentions(0);
        
        // Load reactions for all messages with new Edge Function
        const reactionsMap = new Map();
        for (const message of chatMessages) {
          try {
            const result = await getMessageReactions(message.id);
            if (result.success && result.data && result.data.length > 0) {
              reactionsMap.set(message.id, result.data);
            }
          } catch (err) {
            console.warn('Error loading reactions for message:', message.id, err);
          }
        }
        setMessageReactions(reactionsMap);
        setRetryCount(0); // Reset retry count on success
        
        // Immediately scroll to bottom after loading messages
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 0);
      } catch (err) {
        console.error('Error loading messages:', err);
        
        // Retry logic for message loading
        if (retryAttempt < 2) {
          setTimeout(() => {
            loadMessages(retryAttempt + 1);
          }, 1000 * (retryAttempt + 1));
        } else {
          setError(err as Error);
          onError?.('Failed to load messages after multiple attempts');
        }
      } finally {
        setLoading(false);
        setIsRetrying(false);
      }
    };

    const setupRealTimeUpdates = () => {
      try {
        // Clean up existing polling
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }

        // Set up polling as backup (checks every 3 seconds)
        const pollForNewMessages = async () => {
          try {
            const latestMessages = await CommunityChatService.getMessages(primaryCommunity.id, 10, 0);
            
            if (latestMessages.length > 0) {
              const latestMessageId = latestMessages[latestMessages.length - 1].id;
              
              // Only update if we have new messages
              if (latestMessageId !== lastMessageIdRef.current) {
                setMessages(latestMessages.reverse());
                lastMessageIdRef.current = latestMessageId;
                // Immediately scroll to bottom for new messages
                setTimeout(() => {
                  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }, 0);
              }
            }
          } catch (err) {
            console.error('Error polling for messages:', err);
          }
        };
        
        // Start polling
        pollingIntervalRef.current = setInterval(pollForNewMessages, 3000);
        
        console.log('Polling setup successfully');
      } catch (subscriptionError) {
        console.warn('Real-time subscription failed, falling back to polling:', subscriptionError);
      }
    };

    loadMessages();
    setupRealTimeUpdates();

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [primaryCommunity, user, getMessageReactions, onError]);

  // Load unread mention count
  useEffect(() => {
    if (!user) return;

    const loadUnreadCount = async () => {
      try {
        const count = await CommunityChatService.getUnreadMentionCount(user.id);
        setUnreadMentions(count);
      } catch (err) {
        console.error('Error loading unread mentions:', err);
      }
    };

    loadUnreadCount();
  }, [user]);

  // Handle sending messages
  const handleSend = async (content: string, mediaFile?: File) => {
    if (!primaryCommunity || !user || (!content.trim() && !mediaFile)) return;

    try {
      const message = await CommunityChatService.sendMessage(
        user.id,
        primaryCommunity.id,
        content,
        mediaFile,
        replyingTo?.id || undefined
      );

      // Add message to local state immediately
      setMessages(prev => [...prev, {
        id: message.id,
        communityId: message.communityId,
        userId: message.userId,
        content: message.content,
        mediaUrl: message.mediaUrl,
        mediaType: message.mediaType,
        parentMessageId: message.parentMessageId,
        replyCount: message.replyCount,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        userName: message.userName,
        userAvatarUrl: message.userAvatarUrl
      }]);
      
      setReplyingTo(null);
      
      // Clear members cache since sending a message might affect member status
      clearCache(`members_${primaryCommunity.id}`);
      
      // Immediately scroll to bottom after sending
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 0);
    } catch (err) {
      console.error('Error sending message:', err);
      onError?.('Failed to send message');
    }
  };

  // Handle reaction toggle
  const handleReaction = async (messageId: string) => {
    if (!user) return;
    
    try {
      const result = await toggleMessageReaction(messageId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to toggle reaction');
      }
      
      const reactionAdded = result.data?.reaction_added || false;
      
      // Update local reactions state
      setMessageReactions(prev => {
        const newMap = new Map(prev);
        const currentReactions = newMap.get(messageId) || [];
        
        if (reactionAdded) {
          // Add reaction
          const newReaction = {
            reaction_id: crypto.randomUUID(),
            user_id: user.id,
            user_name: user.user_metadata?.name || 'You',
            created_at: new Date().toISOString()
          };
          newMap.set(messageId, [...currentReactions, newReaction]);
        } else {
          // Remove reaction
          const filteredReactions = currentReactions.filter(r => r.user_id !== user.id);
          if (filteredReactions.length > 0) {
            newMap.set(messageId, filteredReactions);
          } else {
            newMap.delete(messageId);
          }
        }
        
        return newMap;
      });
    } catch (err) {
      console.error('Error toggling reaction:', err);
      onError?.('Failed to toggle reaction');
    }
  };

  // Handle reply
  const handleReply = (message: ChatMessageType) => {
    // Convert ChatMessageType to CommunityMessage for replyingTo state
    const communityMessage: CommunityMessage = {
      id: message.id,
      communityId: message.chatId.replace('community_', ''),
      userId: message.userId,
      content: message.content,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
      parentMessageId: message.parentMessageId,
      replyCount: message.replyCount || 0,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      userName: message.user_name || '',
      userAvatarUrl: message.user_avatar_url
    };
    setReplyingTo(communityMessage);
  };

  // Handle delete
  const handleDelete = async (message: ChatMessageType) => {
    if (!user || message.userId !== user.id) return;
    
    try {
      await CommunityChatService.deleteMessage(user.id, message.id);
      // Message will be removed via real-time subscription
    } catch (err) {
      console.error('Error deleting message:', err);
      onError?.('Failed to delete message');
    }
  };

  // Retry function for failed operations
  const handleRetry = useCallback(() => {
    if (primaryCommunity && user) {
      clearCache(); // Clear all cache
      setError(null);
      setRetryCount(prev => prev + 1);
      
      // Reload messages and members
      const loadMessages = async () => {
        try {
          const chatMessages = await CommunityChatService.getMessages(primaryCommunity.id);
          setMessages(chatMessages.reverse());
        } catch (err) {
          console.error('Retry failed:', err);
        }
      };
      
      loadMessages();
    }
  }, [primaryCommunity, user, clearCache]);
  if (communityLoading || (loading && !isRetrying)) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-400">
        <div className="text-center">
          <MessageCircle size={48} className="mx-auto mb-4 text-gray-600" />
          <p>{isRetrying ? 'Retrying connection...' : 'Loading community chat...'}</p>
          {isRetrying && (
            <div className="mt-2">
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-orange-500 mx-auto" />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!primaryCommunity) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-400">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-gray-600" />
          <p>Please join a community to access community chat</p>
        </div>
      </div>
    );
  }

  // Show error state with retry option
  if (error && !loading) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-400">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-500" />
          <p className="mb-4">Failed to load community chat</p>
          <p className="text-sm text-gray-500 mb-4">{error.message}</p>
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-gray-800/80 rounded-lg shadow-xl h-[600px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <MessageCircle className="text-orange-500" size={20} />
          <div>
            <h3 className="text-lg font-semibold text-white">
              {primaryCommunity.name}
            </h3>
            <p className="text-sm text-gray-400">Community Chat</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {unreadMentions > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-red-500/20 rounded-lg">
              <AtSign size={14} className="text-red-400" />
              <span className="text-xs text-red-400">{unreadMentions} mentions</span>
            </div>
          )}
          
          <button
            onClick={() => setShowMembers(!showMembers)}
            disabled={operationsLoading}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            <Users size={16} className="text-gray-300" />
            <span className="text-sm text-gray-300">
              {operationsLoading ? '...' : members.length}
            </span>
            <ChevronDown size={14} className={`text-gray-300 transition-transform ${showMembers ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-600/20"
      >
        {(error || operationsError) && !loading && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3">
            <p className="text-red-300 text-sm">
              {error?.message || operationsError?.message || 'Connection error occurred.'}
            </p>
            <button
              onClick={handleRetry}
              className="mt-2 px-3 py-1 bg-red-500/20 text-red-300 rounded text-xs hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {messages.length === 0 && !error && !operationsError ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto mb-4 text-gray-600" />
              <h3 className="text-lg font-medium mb-2">Start the conversation!</h3>
              <p className="text-sm">Be the first to send a message in {primaryCommunity.name}</p>
              <p className="text-xs text-gray-500 mt-2">Use @username to mention other members</p>
            </div>
          </div>
        ) : (
          messages.map(message => (
            <ChatMessage
              key={message.id}
              message={{
                id: message.id,
                chatId: `community_${message.communityId}`,
                userId: message.userId,
                content: message.content,
                mediaUrl: message.mediaUrl,
                mediaType: message.mediaType,
                isVerification: false, // Community chat doesn't have verification
                parentMessageId: message.parentMessageId,
                parentMessage: message.parentMessageId ? {
                  id: message.parentMessageId,
                  content: messages.find(m => m.id === message.parentMessageId)?.content || '',
                  userId: messages.find(m => m.id === message.parentMessageId)?.userId || '',
                  user_name: messages.find(m => m.id === message.parentMessageId)?.userName || '',
                  isVerification: false,
                  mediaUrl: messages.find(m => m.id === message.parentMessageId)?.mediaUrl,
                  mediaType: messages.find(m => m.id === message.parentMessageId)?.mediaType
                } : undefined,
                replyCount: message.replyCount,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt,
                user_name: message.userName,
                user_avatar_url: message.userAvatarUrl
              }}
              onReply={handleReply}
              onDelete={handleDelete}
              challengeId={undefined}
              showVerificationBadge={false}
              currentUserId={user?.id}
              onReaction={handleReaction}
              messageReactions={messageReactions.get(message.id) || []}
              className="community-message"
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-700">
        {replyingTo && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-700/50">
            <span className="text-xs text-gray-400">Replying to {replyingTo.userName}</span>
            <button
              onClick={() => setReplyingTo(null)}
              className="text-gray-400 hover:text-white"
            >
              ×
            </button>
          </div>
        )}
        
        <div className="p-4">
          <EnhancedChatInput
            onSend={handleSend}
            disabled={loading || operationsLoading}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            members={members}
            allowMentions={true}
          />
        </div>
      </div>

      {/* Members List - Simple dropdown for now */}
      {showMembers && (
        <div className="absolute top-16 right-4 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto min-w-48 z-50">
          <div className="p-2">
            <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
              <Users size={12} />
              <span>Community Members</span>
              {operationsLoading && (
                <div className="animate-spin rounded-full h-3 w-3 border border-orange-500 border-t-transparent ml-1" />
              )}
            </div>
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-2 p-2 rounded hover:bg-gray-700/50 transition-colors"
              >
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt={member.name}
                    className="w-6 h-6 rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center">
                    <User size={12} className="text-gray-400" />
                  </div>
                )}
                <span className="text-sm text-white">{member.name}</span>
              </div>
            ))}
            {members.length === 0 && !operationsLoading && (
              <div className="text-xs text-gray-500 text-center py-2">
                No members found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}