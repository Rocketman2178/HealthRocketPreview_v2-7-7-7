import React, { useState, useEffect, useRef } from 'react';
import { Send, Smile, User, Reply, Zap, Trash2, MessageSquare } from 'lucide-react';
import { useSupabase } from '../../contexts/SupabaseContext';
import { CommunityChatService } from '../../lib/chat/CommunityChatService';
import { useCommunity } from '../../hooks/useCommunity';
import { useCommunityChat } from '../../hooks/useCommunityChat';
import EmojiPicker from 'emoji-picker-react';
import type { CommunityMessage, CommunityMember } from '../../types/community';

interface CommunityChatProps {
  onError?: (error: Error) => void;
}

export function CommunityChat({ onError }: CommunityChatProps) {
  const { user } = useSupabase();
  const { primaryCommunity } = useCommunity(user?.id);
  const { markMentionsAsRead } = useCommunityChat();
  
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

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

  // Load messages and members
  useEffect(() => {
    if (!user || !primaryCommunity) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        
        // Load messages and members in parallel
        const [messagesData, membersData] = await Promise.all([
          CommunityChatService.getMessages(primaryCommunity.id),
          CommunityChatService.getCommunityMembers(primaryCommunity.id)
        ]);

        setMessages(messagesData);
        setMembers(membersData);
        
        // Mark mentions as read when opening chat
        await markMentionsAsRead();
      } catch (err) {
        console.error('Error loading community chat data:', err);
        if (onError) {
          onError(err instanceof Error ? err : new Error('Failed to load chat'));
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user, primaryCommunity, markMentionsAsRead, onError]);

  // Subscribe to new messages
  useEffect(() => {
    if (!primaryCommunity) return;

    const subscription = CommunityChatService.subscribeToMessages(
      primaryCommunity.id,
      (message) => {
        setMessages(prev => [...prev, message]);
      },
      (messageId) => {
        setMessages(prev => prev.filter(m => m.id !== messageId));
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [primaryCommunity]);

  // Handle mention detection
  const handleContentChange = (value: string) => {
    setNewMessage(value);
    
    // Find @ symbol and check for mention
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      // Only show mentions if there's no space after @ (active mention)
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

  // Handle mention selection
  const handleMentionSelect = (member: CommunityMember) => {
    if (mentionStartIndex === -1) return;
    
    const beforeMention = newMessage.slice(0, mentionStartIndex);
    const afterMention = newMessage.slice(mentionStartIndex + 1 + mentionQuery.length);
    const newContent = `${beforeMention}@${member.name} ${afterMention}`;
    
    setNewMessage(newContent);
    setShowMentions(false);
    setMentionQuery('');
    
    // Focus back to textarea
    textareaRef.current?.focus();
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiData: any) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  // Send message
  const handleSendMessage = async () => {
    if (!user || !primaryCommunity || !newMessage.trim() || sending) return;

    try {
      setSending(true);
      
      // Create optimistic message
      const optimisticMessage: CommunityMessage = {
        id: `temp-${Date.now()}`,
        communityId: primaryCommunity.id,
        userId: user.id,
        content: newMessage.trim(),
        parentMessageId: replyingTo?.id,
        parentMessage: replyingTo ? {
          id: replyingTo.id,
          content: replyingTo.content,
          userId: replyingTo.userId,
          userName: replyingTo.userName,
          isVerification: false,
          mediaUrl: replyingTo.mediaUrl,
          mediaType: replyingTo.mediaType
        } : undefined,
        replyCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        userName: user.user_metadata?.name || 'You',
        userAvatarUrl: user.user_metadata?.avatar_url
      };

      // Add optimistic message immediately
      setMessages(prev => [...prev, optimisticMessage]);
      setNewMessage('');
      setReplyingTo(null);

      // Send to server
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
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
      if (onError) {
        onError(err instanceof Error ? err : new Error('Failed to send message'));
      }
    } finally {
      setSending(false);
    }
  };

  // Handle reply
  const handleReply = (message: CommunityMessage) => {
    setReplyingTo(message);
    textareaRef.current?.focus();
  };

  // Handle delete
  const handleDelete = async (message: CommunityMessage) => {
    if (!user || message.userId !== user.id) return;

    try {
      await CommunityChatService.deleteMessage(message.id, user.id);
      setMessages(prev => prev.filter(m => m.id !== message.id));
    } catch (err) {
      console.error('Error deleting message:', err);
      if (onError) {
        onError(err instanceof Error ? err : new Error('Failed to delete message'));
      }
    }
  };

  // Handle reaction toggle
  const handleReactionToggle = async (messageId: string) => {
    if (!user) return;

    try {
      await CommunityChatService.toggleReaction(messageId, user.id);
      // Reactions will be updated via real-time subscription
    } catch (err) {
      console.error('Error toggling reaction:', err);
      if (onError) {
        onError(err instanceof Error ? err : new Error('Failed to toggle reaction'));
      }
    }
  };

  // Filter members for mentions
  const filteredMembers = members.filter(member =>
    member.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  if (!primaryCommunity) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 text-center">
        <MessageSquare className="mx-auto mb-3 text-gray-400" size={32} />
        <h3 className="text-lg font-medium text-white mb-2">No Community Selected</h3>
        <p className="text-gray-400">Join a community to start chatting with other members.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="text-orange-500" size={20} />
            <h3 className="text-lg font-medium text-white">{primaryCommunity.name}</h3>
          </div>
          <div className="text-sm text-gray-400">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="h-[500px] overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <MessageSquare className="mx-auto mb-3 text-gray-400" size={32} />
              <p className="text-gray-400">No messages yet</p>
              <p className="text-sm text-gray-500 mt-1">Be the first to start the conversation!</p>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isOwnMessage = message.userId === user?.id;
            
            return (
              <div key={message.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] ${isOwnMessage ? 'order-2' : 'order-1'}`}>
                  {/* Reply indicator */}
                  {message.parentMessage && (
                    <div className={`mb-2 p-2 rounded-lg bg-gray-700/50 border-l-2 border-orange-500 ${isOwnMessage ? 'ml-auto' : ''}`}>
                      <div className="flex items-center gap-2 text-xs text-orange-500">
                        <Reply size={12} />
                        <span>Replying to {message.parentMessage.userName}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1 truncate">
                        {message.parentMessage.content}
                      </p>
                    </div>
                  )}
                  
                  {/* Message bubble */}
                  <div className={`inline-block px-3 py-2 rounded-lg ${
                    isOwnMessage 
                      ? 'bg-gray-800 border border-orange-500/50 text-white' 
                      : 'bg-gray-700 border border-green-500/50 text-white'
                  }`}>
                    {/* User name for other messages */}
                    {!isOwnMessage && (
                      <div className="text-xs text-orange-500 font-medium mb-1">
                        {message.userName || 'Unknown User'}
                      </div>
                    )}
                    
                    {/* Message content */}
                    <div 
                      className="text-sm break-words"
                      dangerouslySetInnerHTML={{
                        __html: message.content.replace(
                          /@([A-Za-z]+(?:\s+[A-Za-z]+)*?)(?=\s+[a-z]|\s*[!.?,:;]|\s*$)/g,
                          '<span class="text-orange-500 font-bold">@$1</span>'
                        )
                      }}
                    />
                    
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
                    
                    {/* Message footer */}
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="text-gray-400">
                        {message.createdAt.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric'
                        })} {message.createdAt.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })}
                      </span>
                      
                      <div className="flex items-center gap-2">
                        {/* Reply count */}
                        {message.replyCount > 0 && (
                          <span className="text-gray-400">
                            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
                          </span>
                        )}
                        
                        {/* Action buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleReply(message)}
                            className="text-gray-400 hover:text-orange-500 transition-colors"
                            title="Reply"
                          >
                            <Reply size={14} />
                          </button>
                          
                          {!isOwnMessage && (
                            <button
                              onClick={() => handleReactionToggle(message.id)}
                              className="text-gray-400 hover:text-orange-500 transition-colors"
                              title="Like"
                            >
                              <Zap size={14} />
                            </button>
                          )}
                          
                          {isOwnMessage && (
                            <button
                              onClick={() => handleDelete(message)}
                              className="text-gray-400 hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Avatar for other users */}
                {!isOwnMessage && (
                  <div className="order-1 mr-3 mt-auto">
                    {message.userAvatarUrl ? (
                      <img
                        src={message.userAvatarUrl}
                        alt={message.userName}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center">
                        <User className="text-gray-400" size={16} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-700">
        {/* Reply indicator */}
        {replyingTo && (
          <div className="flex items-center justify-between p-2 bg-gray-700/50 border-b border-gray-600">
            <div className="flex items-center gap-2">
              <Reply size={14} className="text-orange-500" />
              <span className="text-xs text-gray-400">Replying to {replyingTo.userName}</span>
              <span className="text-xs text-gray-400 truncate max-w-32">
                {replyingTo.content.substring(0, 50)}...
              </span>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
        )}

        {/* Mentions dropdown */}
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

        {/* Emoji picker */}
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

        {/* Input form */}
        <div className="p-4 relative">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={newMessage}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Type a message or use @ to mention a user"
                className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                  if (e.key === 'Escape') {
                    setShowEmojiPicker(false);
                    setShowMentions(false);
                  }
                }}
              />
              
              {/* Emoji button inside textarea */}
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-orange-500 transition-colors"
                title="Add emoji"
              >
                <Smile size={18} />
              </button>
            </div>

            {/* Send button */}
            <button
              onClick={handleSendMessage}
              disabled={sending || !newMessage.trim()}
              className="p-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}