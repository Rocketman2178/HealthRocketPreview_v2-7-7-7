import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, Users, AlertTriangle, Loader2, User, X, Heart, Reply, Trash2 } from 'lucide-react';
import { useSupabase } from '../../contexts/SupabaseContext';
import { useCommunity } from '../../hooks/useCommunity';
import { CommunityChatService } from '../../lib/chat/CommunityChatService';
import { Card } from '../ui/card';
import type { CommunityMessage } from '../../lib/chat/CommunityChatService';

interface CommunityChatProps {
  onError?: (error: Error) => void;
}

export function CommunityChat({ onError }: CommunityChatProps) {
  const { user } = useSupabase();
  const { primaryCommunity } = useCommunity(user?.id);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  const [reactions, setReactions] = useState<Record<string, any[]>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Load messages when component mounts or community changes
  useEffect(() => {
    if (!primaryCommunity?.id || !user) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const loadMessages = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const fetchedMessages = await CommunityChatService.getMessages(primaryCommunity.id);
        setMessages(fetchedMessages);
        
        // Load reactions for all messages
        const reactionPromises = fetchedMessages.map(async (msg) => {
          try {
            const msgReactions = await CommunityChatService.getMessageReactions(msg.id);
            return { messageId: msg.id, reactions: msgReactions };
          } catch (err) {
            console.warn(`Failed to load reactions for message ${msg.id}:`, err);
            return { messageId: msg.id, reactions: [] };
          }
        });
        
        const reactionResults = await Promise.all(reactionPromises);
        const reactionMap: Record<string, any[]> = {};
        reactionResults.forEach(({ messageId, reactions: msgReactions }) => {
          reactionMap[messageId] = msgReactions;
        });
        setReactions(reactionMap);
      } catch (err) {
        console.error('Error loading community messages:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load messages';
        setError(errorMessage);
        if (onError) {
          onError(err instanceof Error ? err : new Error(errorMessage));
        }
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, [primaryCommunity?.id, user, onError]);

  // Subscribe to new messages with proper cleanup
  useEffect(() => {
    if (!primaryCommunity?.id) return;

    // Clean up previous subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
    }

    try {
      subscriptionRef.current = CommunityChatService.subscribeToMessages(
        primaryCommunity.id,
        (newMessage) => {
          // Add new messages to END of array (newest at bottom)
          setMessages(prev => [...prev, newMessage]);
        },
        (deletedMessageId) => {
          setMessages(prev => prev.filter(msg => msg.id !== deletedMessageId));
        }
      );
    } catch (err) {
      console.error('Error setting up message subscription:', err);
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, [primaryCommunity?.id]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = useCallback(async () => {
    if (!newMessage.trim() || !primaryCommunity?.id || !user || sending) return;

    try {
      setSending(true);
      setError(null);

      await CommunityChatService.sendMessage(
        user.id,
        primaryCommunity.id,
        newMessage.trim(),
        undefined,
        replyingTo?.id
      );

      setNewMessage('');
      setReplyingTo(null);
    } catch (err) {
      console.error('Error sending message:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      if (onError) {
        onError(err instanceof Error ? err : new Error(errorMessage));
      }
    } finally {
      setSending(false);
    }
  }, [newMessage, primaryCommunity?.id, user, sending, replyingTo, onError]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleToggleReaction = useCallback(async (messageId: string) => {
    if (!user) return;

    try {
      const reactionAdded = await CommunityChatService.toggleReaction(user.id, messageId);
      
      // Update local reactions state
      setReactions(prev => {
        const messageReactions = prev[messageId] || [];
        
        if (reactionAdded) {
          // Add new reaction
          const newReaction = {
            id: `temp-${Date.now()}`,
            user_id: user.id,
            user_name: user.user_metadata?.name || 'You',
            created_at: new Date().toISOString()
          };
          return {
            ...prev,
            [messageId]: [...messageReactions, newReaction]
          };
        } else {
          // Remove reaction
          return {
            ...prev,
            [messageId]: messageReactions.filter(r => r.user_id !== user.id)
          };
        }
      });
    } catch (err) {
      console.error('Error toggling reaction:', err);
    }
  }, [user]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!user) return;

    try {
      await CommunityChatService.deleteMessage(user.id, messageId);
      // Message will be removed via real-time subscription
    } catch (err) {
      console.error('Error deleting message:', err);
      setError('Failed to delete message');
    }
  }, [user]);

  if (!primaryCommunity) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <Users className="mx-auto mb-4 text-gray-400" size={48} />
          <h3 className="text-lg font-semibold text-white mb-2">No Community Selected</h3>
          <p className="text-gray-400">Join a community to start chatting with other members.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-96">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <MessageCircle className="text-orange-500" size={20} />
          <h3 className="text-lg font-semibold text-white">{primaryCommunity.name}</h3>
        </div>
        <div className="text-sm text-gray-400">
          {messages.length} messages
        </div>
      </div>

      {/* Reply Banner */}
      {replyingTo && (
        <div className="flex items-center justify-between p-2 bg-gray-700/50 border-b border-gray-600">
          <div className="flex items-center gap-2">
            <Reply size={14} className="text-orange-500" />
            <span className="text-xs text-gray-400">Replying to</span>
            <span className="text-xs text-white font-medium">{replyingTo.userName}</span>
            <span className="text-xs text-gray-400 truncate max-w-32">
              {replyingTo.content.substring(0, 50)}...
            </span>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-orange-500" size={24} />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <AlertTriangle className="mx-auto mb-2 text-red-400" size={24} />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageCircle className="mx-auto mb-2 text-gray-400" size={24} />
              <p className="text-gray-400">No messages yet</p>
              <p className="text-gray-500 text-sm">Be the first to start the conversation!</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => {
              const isMyMessage = message.userId === user?.id;
              const messageReactions = reactions[message.id] || [];
              const hasReacted = messageReactions.some(r => r.user_id === user?.id);
              
              return (
                <div
                  key={message.id}
                  className="group"
                >
                  <div
                    className={`flex ${isMyMessage ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="flex items-end gap-2 max-w-[80%]">
                      {/* Avatar for other users */}
                      {!isMyMessage && (
                        message.userAvatarUrl ? (
                          <img
                            src={message.userAvatarUrl}
                            alt={message.userName}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center">
                            <User className="text-gray-400" size={16} />
                          </div>
                        )
                      )}

                      <div className="flex flex-col">
                        <div
                          className={`rounded-lg p-3 ${
                            isMyMessage
                              ? 'bg-gray-800 border-2 border-orange-500 text-white rounded-br-none'
                              : 'bg-gray-700 border-2 border-green-500 text-gray-100 rounded-bl-none'
                          }`}
                        >
                          {/* User name for other messages */}
                          {!isMyMessage && (
                            <div className="text-xs text-green-400 font-medium mb-1">
                              {message.userName}
                            </div>
                          )}
                          
                          {/* Message content */}
                          <div className="text-sm">{message.content}</div>
                          
                          {/* Media */}
                          {message.mediaUrl && (
                            <div className="mt-2">
                              {message.mediaType === 'image' ? (
                                <img
                                  src={message.mediaUrl}
                                  alt="Message attachment"
                                  className="max-w-sm max-h-48 object-contain rounded"
                                />
                              ) : (
                                <video
                                  src={message.mediaUrl}
                                  controls
                                  className="max-w-sm max-h-48 object-contain rounded"
                                />
                              )}
                            </div>
                          )}
                          
                          {/* Timestamp and actions */}
                          <div className="flex items-center justify-between mt-2">
                            <div className="text-xs opacity-75">
                              {new Date(message.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                            
                            {/* Message actions - show on hover */}
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* Reply button */}
                              <button
                                onClick={() => setReplyingTo(message)}
                                className="text-gray-400 hover:text-orange-500 transition-colors"
                                title="Reply"
                              >
                                <Reply size={14} />
                              </button>
                              
                              {/* Like button - only for other users' messages */}
                              {!isMyMessage && (
                                <button
                                  onClick={() => handleToggleReaction(message.id)}
                                  className={`transition-colors ${
                                    hasReacted 
                                      ? 'text-red-500 hover:text-red-400' 
                                      : 'text-gray-400 hover:text-red-500'
                                  }`}
                                  title={hasReacted ? 'Unlike' : 'Like'}
                                >
                                  <Heart size={14} fill={hasReacted ? 'currentColor' : 'none'} />
                                </button>
                              )}
                              
                              {/* Delete button - only for own messages */}
                              {isMyMessage && (
                                <button
                                  onClick={() => handleDeleteMessage(message.id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                          
                          {/* Reactions display */}
                          {messageReactions.length > 0 && (
                            <div className="flex items-center gap-1 mt-2">
                              <Heart size={12} className="text-red-500" />
                              <span className="text-xs text-gray-400">
                                {messageReactions.length} {messageReactions.length === 1 ? 'like' : 'likes'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={replyingTo ? `Reply to ${replyingTo.userName}...` : "Type a message..."}
            disabled={sending}
            className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
          />
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim() || sending}
            className="bg-orange-500 text-white rounded-lg p-2 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
      </div>
    </Card>
  );
}