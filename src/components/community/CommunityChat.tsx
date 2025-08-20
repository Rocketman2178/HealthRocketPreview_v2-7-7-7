import React, { useState, useEffect, useRef } from 'react';
import { Send, User, Zap, Reply, Trash2, Smile, X } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { useSupabase } from '../../contexts/SupabaseContext';
import { useCommunity } from '../../hooks/useCommunity';
import { CommunityChatService } from '../../lib/chat/CommunityChatService';
import type { CommunityMessage } from '../../types/community';

interface CommunityMember {
  id: string;
  name: string;
  avatarUrl?: string;
}

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
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = (smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end'
      });
    }
  };

  // Load initial messages
  useEffect(() => {
    if (!primaryCommunity?.id || !user) return;

    const loadMessages = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load messages and members in parallel
        const [messagesData, membersData] = await Promise.all([
          CommunityChatService.getMessages(primaryCommunity.id),
          CommunityChatService.getCommunityMembers(primaryCommunity.id)
        ]);

        setMessages(messagesData);
        setMembers(membersData);

        // Scroll to bottom after messages load
        setTimeout(() => scrollToBottom(false), 100);
      } catch (err) {
        console.error('Error loading community chat:', err);
        setError('Failed to load messages');
        onError?.(err instanceof Error ? err : new Error('Failed to load messages'));
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, [primaryCommunity?.id, user, onError]);

  // Set up real-time subscription
  useEffect(() => {
    if (!primaryCommunity?.id || !user) return;

    const subscription = CommunityChatService.subscribeToMessages(
      primaryCommunity.id,
      (newMessage) => {
        setMessages(prev => {
          // Check if message already exists to prevent duplicates
          if (prev.some(msg => msg.id === newMessage.id)) {
            return prev;
          }
          const updated = [...prev, newMessage];
          // Scroll to bottom when new message arrives
          setTimeout(() => scrollToBottom(), 100);
          return updated;
        });
      },
      (deletedMessageId) => {
        setMessages(prev => prev.filter(msg => msg.id !== deletedMessageId));
      }
    );

    subscriptionRef.current = subscription;

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [primaryCommunity?.id, user]);

  // Handle mention detection
  const handleMentionDetection = (value: string) => {
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ') && textAfterAt.length >= 0) {
        setMentionQuery(textAfterAt);
        setMentionStartIndex(lastAtIndex);
        setShowMentions(true);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };

  // Handle message input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNewMessage(value);
    handleMentionDetection(value);
  };

  // Handle mention selection
  const handleMentionSelect = (member: CommunityMember) => {
    if (mentionStartIndex === -1) return;
    
    const beforeMention = newMessage.slice(0, mentionStartIndex);
    const afterMention = newMessage.slice(mentionStartIndex + 1 + mentionQuery.length);
    const newContent = `${beforeMention}@${member.name} ${afterMention}`;
    
    setNewMessage(newContent);
    setShowMentions(false);
    setMentionQuery('');
    inputRef.current?.focus();
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiData: any) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  };

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  // Handle sending message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !primaryCommunity?.id || !user || sending) return;

    try {
      setSending(true);
      setError(null);

      // Optimistically add message to UI
      const optimisticMessage: CommunityMessage = {
        id: `temp-${Date.now()}`,
        communityId: primaryCommunity.id,
        userId: user.id,
        content: newMessage.trim(),
        parentMessageId: replyingTo?.id,
        replyCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        userName: user.user_metadata?.name || user.email?.split('@')[0] || 'You',
        userAvatarUrl: user.user_metadata?.avatar_url
      };

      setMessages(prev => [...prev, optimisticMessage]);
      setNewMessage('');
      setReplyingTo(null);

      // Scroll to bottom immediately
      setTimeout(() => scrollToBottom(), 50);

      // Send to database
      const sentMessage = await CommunityChatService.sendMessage(
        user.id,
        primaryCommunity.id,
        newMessage.trim(),
        undefined,
        undefined,
        replyingTo?.id
      );

      // Replace optimistic message with real one
      setMessages(prev => 
        prev.map(msg => 
          msg.id === optimisticMessage.id ? sentMessage : msg
        )
      );

    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to send message');
      
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== `temp-${Date.now()}`));
      
      onError?.(err instanceof Error ? err : new Error('Failed to send message'));
    } finally {
      setSending(false);
    }
  };

  // Handle message deletion
  const handleDeleteMessage = async (messageId: string) => {
    if (!user) return;

    try {
      await CommunityChatService.deleteMessage(user.id, messageId);
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } catch (err) {
      console.error('Error deleting message:', err);
      setError('Failed to delete message');
    }
  };

  // Handle reaction toggle
  const handleToggleReaction = async (messageId: string) => {
    if (!user) return;

    try {
      const reactionAdded = await CommunityChatService.toggleReaction(user.id, messageId);
      
      // Update local state optimistically
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId) {
          const reactions = msg.reactions || [];
          if (reactionAdded) {
            // Add reaction
            return {
              ...msg,
              reactions: [...reactions, {
                id: `temp-${Date.now()}`,
                user_id: user.id,
                user_name: user.user_metadata?.name || 'You',
                created_at: new Date().toISOString()
              }]
            };
          } else {
            // Remove reaction
            return {
              ...msg,
              reactions: reactions.filter(r => r.user_id !== user.id)
            };
          }
        }
        return msg;
      }));
    } catch (err) {
      console.error('Error toggling reaction:', err);
      setError('Failed to update reaction');
    }
  };

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Format content with mentions
  const formatContentWithMentions = (content: string): string => {
    return content.replace(
      /@([A-Za-z]+(?:\s+[A-Za-z]+)*?)(?=\s+[a-z]|\s*[!.?,:;]|\s*$)/g,
      '<span class="text-orange-500 font-bold">@$1</span>'
    );
  };

  // Filter members for mentions
  const filteredMembers = members.filter(member =>
    member.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  if (!primaryCommunity) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 text-center">
        <div className="text-gray-400 mb-4">
          <User size={48} className="mx-auto mb-2" />
          <p>Join a community to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div id="community" className="space-y-4 scroll-mt-20">
      <div className="bg-gray-800/50 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="text-orange-500" size={20} />
              <h3 className="text-lg font-semibold text-white">{primaryCommunity.name}</h3>
            </div>
            <div className="text-sm text-gray-400">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </div>
          </div>
        </div>

        {/* Messages Container */}
        <div 
          ref={messagesContainerRef}
          className="h-[500px] overflow-y-auto p-4 space-y-4"
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500" />
            </div>
          ) : error ? (
            <div className="text-center text-red-400 py-8">
              <p>{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="mt-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
              >
                Retry
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <User size={32} className="mx-auto mb-2" />
              <p>No messages yet</p>
              <p className="text-sm mt-1">Be the first to start the conversation!</p>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="group">
                {/* Reply indicator */}
                {message.parentMessageId && (
                  <div className="mb-2 ml-4 pl-3 border-l-2 border-gray-600">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Reply size={12} />
                      <span>Replying to a message</span>
                    </div>
                  </div>
                )}

                <div className={`flex gap-3 ${message.userId === user?.id ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar - only for others */}
                  {message.userId !== user?.id && (
                    <div className="flex-shrink-0">
                      {message.userAvatarUrl ? (
                        <img
                          src={message.userAvatarUrl}
                          alt={message.userName}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                          <User size={16} className="text-gray-400" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message Content */}
                  <div className={`flex-1 max-w-[70%] ${message.userId === user?.id ? 'text-right' : 'text-left'}`}>
                    <div
                      className={`rounded-lg p-3 ${
                        message.userId === user?.id
                          ? 'bg-gray-800 border-2 border-orange-500 text-white ml-auto'
                          : 'bg-gray-700 border-2 border-green-500 text-gray-100'
                      }`}
                    >
                      {/* User name for others */}
                      {message.userId !== user?.id && (
                        <div className="text-xs text-green-400 font-medium mb-1">
                          {message.userName}
                        </div>
                      )}

                      {/* Message content with mentions */}
                      <div 
                        className="text-sm break-words"
                        dangerouslySetInnerHTML={{
                          __html: formatContentWithMentions(message.content)
                        }}
                      />

                      {/* Message metadata and actions */}
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <span className="text-gray-400">
                          {message.createdAt.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>

                        {/* Action buttons - always visible */}
                        <div className="flex items-center gap-2">
                          {/* Reply button */}
                          <button
                            onClick={() => setReplyingTo(message)}
                            className="text-gray-400 hover:text-blue-400 transition-colors"
                            title="Reply"
                          >
                            <Reply size={14} />
                          </button>

                          {/* Like button - only for others' messages */}
                          {message.userId !== user?.id && (
                            <button
                              onClick={() => handleToggleReaction(message.id)}
                              className={`transition-colors ${
                                message.reactions?.some(r => r.user_id === user?.id)
                                  ? 'text-orange-500'
                                  : 'text-gray-400 hover:text-orange-400'
                              }`}
                              title="Like"
                            >
                              <Zap size={14} />
                            </button>
                          )}

                          {/* Delete button - only for own messages */}
                          {message.userId === user?.id && (
                            <button
                              onClick={() => handleDeleteMessage(message.id)}
                              className="text-gray-400 hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}

                          {/* Reaction count */}
                          {message.reactions && message.reactions.length > 0 && (
                            <div className="flex items-center gap-1 text-orange-500">
                              <Zap size={12} />
                              <span>{message.reactions.length}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-700 p-4 relative">
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

          {/* Mentions Dropdown */}
          {showMentions && filteredMembers.length > 0 && (
            <div className="absolute bottom-full mb-2 left-4 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-32 overflow-y-auto min-w-48 z-50">
              <div className="p-2">
                {filteredMembers.slice(0, 5).map((member) => (
                  <button
                    key={member.id}
                    onClick={() => handleMentionSelect(member)}
                    className="w-full flex items-center gap-2 p-2 rounded hover:bg-gray-700/50 transition-colors text-left"
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
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reply indicator */}
          {replyingTo && (
            <div className="flex items-center justify-between p-2 bg-gray-700/50 rounded-lg mb-2">
              <div className="flex items-center gap-2">
                <Reply size={14} className="text-orange-500" />
                <span className="text-xs text-gray-400">
                  Replying to {replyingTo.userName}
                </span>
                <span className="text-xs text-gray-500 truncate max-w-32">
                  {replyingTo.content.substring(0, 50)}...
                </span>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Input form */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={handleInputChange}
                onKeyDown={handleKeyPress}
                placeholder="Type a message..."
                className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                rows={1}
                disabled={sending}
              />
            </div>

            <div className="flex items-center gap-2">
              {/* Emoji button */}
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="p-2 text-gray-400 hover:text-orange-500 transition-colors"
                title="Add emoji"
              >
                <Smile size={20} />
              </button>

              {/* Send button */}
              <button
                onClick={handleSendMessage}
                disabled={sending || !newMessage.trim()}
                className="p-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Send message"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}