import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, User, X, Reply, Smile, AlertTriangle } from 'lucide-react';
import { useSupabase } from '../../contexts/SupabaseContext';
import { useCommunity } from '../../hooks/useCommunity';
import { useCommunityChat } from '../../hooks/useCommunityChat';
import { CommunityChatService } from '../../lib/chat/CommunityChatService';
import { EnhancedChatInput } from './EnhancedChatInput';
import { ChatMessage } from '../chat/ChatMessage';
import type { CommunityMessage, CommunityMember } from '../../types/community';

interface CommunityChatProps {
  onError?: (error: Error) => void;
}

export function CommunityChat({ onError }: CommunityChatProps) {
  const { user } = useSupabase();
  const { primaryCommunity } = useCommunity(user?.id);
  const { markMentionsAsRead } = useCommunityChat();
  
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Load initial data
  useEffect(() => {
    if (!primaryCommunity?.id || !user) {
      setLoading(false);
      return;
    }

    const loadCommunityData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load messages
        const messagesData = await CommunityChatService.getMessages(primaryCommunity.id);
        setMessages(messagesData);

        // Load members for mentions
        const membersData = await CommunityChatService.getCommunityMembers(primaryCommunity.id);
        setMembers(membersData);

        // Mark mentions as read when opening chat
        await markMentionsAsRead();

      } catch (err) {
        console.error('Error loading community chat:', err);
        setError(err instanceof Error ? err.message : 'Failed to load chat');
        if (onError) {
          onError(err instanceof Error ? err : new Error('Failed to load chat'));
        }
      } finally {
        setLoading(false);
      }
    };

    loadCommunityData();
  }, [primaryCommunity?.id, user, markMentionsAsRead, onError]);

  // Subscribe to new messages
  useEffect(() => {
    if (!primaryCommunity?.id) return;

    // Clean up existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
    }

    try {
      subscriptionRef.current = CommunityChatService.subscribeToMessages(
        primaryCommunity.id,
        (newMessage) => {
          setMessages(prev => {
            // Prevent duplicates
            if (prev.some(msg => msg.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage];
          });
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

  const handleSendMessage = async (content: string, mediaFile?: File) => {
    if (!user || !primaryCommunity?.id || !content.trim()) return;

    try {
      let mediaUrl: string | undefined;
      let mediaType: 'image' | 'video' | undefined;

      // Handle media upload if present
      if (mediaFile) {
        const fileExt = mediaFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `community/${primaryCommunity.id}/${user.id}/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(filePath, mediaFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('chat-media')
          .getPublicUrl(filePath);

        mediaUrl = publicUrl;
        mediaType = mediaFile.type.startsWith('image/') ? 'image' : 'video';
      }

      // Send message
      const newMessage = await CommunityChatService.sendMessage(
        user.id,
        primaryCommunity.id,
        content,
        mediaUrl,
        mediaType,
        replyingTo?.id
      );

      // Clear reply state
      setReplyingTo(null);

      // Add to local state (will also come through subscription)
      setMessages(prev => {
        if (prev.some(msg => msg.id === newMessage.id)) {
          return prev;
        }
        return [...prev, newMessage];
      });

    } catch (err) {
      console.error('Error sending message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      if (onError) {
        onError(err instanceof Error ? err : new Error('Failed to send message'));
      }
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!user) return;

    try {
      await CommunityChatService.deleteMessage(messageId, user.id);
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } catch (err) {
      console.error('Error deleting message:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete message');
    }
  };

  const handleReply = (message: CommunityMessage) => {
    setReplyingTo(message);
  };

  // Show loading state
  if (loading) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500" />
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6">
        <div className="flex items-center gap-3 text-red-400">
          <AlertTriangle size={20} />
          <div>
            <p className="font-medium">Community Chat Error</p>
            <p className="text-sm text-gray-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Show no community state
  if (!primaryCommunity) {
    return (
      <div className="bg-gray-800/50 rounded-lg p-6 text-center">
        <MessageCircle className="text-orange-500 mx-auto mb-3" size={32} />
        <h3 className="text-lg font-medium text-white mb-2">Join a Community</h3>
        <p className="text-gray-400">
          You need to join a community to access community chat features.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <MessageCircle className="text-orange-500" size={20} />
          <div>
            <h3 className="text-lg font-medium text-white">{primaryCommunity.name}</h3>
            <p className="text-sm text-gray-400">{members.length} members</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="h-[400px] overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <MessageCircle className="mx-auto mb-2" size={24} />
            <p>No messages yet</p>
            <p className="text-sm text-gray-500 mt-1">Be the first to start the conversation!</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="space-y-2">
              {/* Reply indicator */}
              {message.parentMessage && (
                <div className="ml-4 pl-3 border-l-2 border-gray-600 text-xs text-gray-400">
                  <div className="flex items-center gap-1">
                    <Reply size={12} />
                    <span>Replying to {message.parentMessage.userName}</span>
                  </div>
                  <p className="truncate max-w-xs">{message.parentMessage.content}</p>
                </div>
              )}

              {/* Message */}
              <div className={`flex ${message.userId === user?.id ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] inline-block ${message.userId === user?.id ? 'order-2' : 'order-1'}`}>
                  {/* Avatar for other users */}
                  {message.userId !== user?.id && (
                    <div className="flex items-center gap-2 mb-1">
                      {message.userAvatarUrl ? (
                        <img
                          src={message.userAvatarUrl}
                          alt={message.userName}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center">
                          <User size={12} className="text-gray-400" />
                        </div>
                      )}
                      <span className="text-xs text-orange-500 font-medium">
                        {message.userName}
                      </span>
                    </div>
                  )}

                  {/* Message bubble */}
                  <div
                    className={`px-3 py-2 rounded-lg ${
                      message.userId === user?.id
                        ? 'bg-orange-500 text-white rounded-br-none'
                        : 'bg-gray-700 text-white rounded-bl-none'
                    }`}
                  >
                    {/* Media */}
                    {message.mediaUrl && (
                      <div className="mb-2">
                        {message.mediaType === 'image' ? (
                          <img
                            src={message.mediaUrl}
                            alt="Message attachment"
                            className="max-w-full h-auto rounded"
                          />
                        ) : (
                          <video
                            src={message.mediaUrl}
                            controls
                            className="max-w-full h-auto rounded"
                          />
                        )}
                      </div>
                    )}

                    {/* Content */}
                    <div className="text-sm whitespace-pre-wrap break-words">
                      {message.content}
                    </div>

                    {/* Timestamp and actions */}
                    <div className="flex items-center justify-between mt-2 text-xs opacity-75">
                      <span>
                        {new Date(message.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        })}
                      </span>
                      
                      <div className="flex items-center gap-2">
                        {/* Reply button */}
                        <button
                          onClick={() => handleReply(message)}
                          className="hover:text-orange-300 transition-colors"
                        >
                          <Reply size={12} />
                        </button>
                        
                        {/* Delete button for own messages */}
                        {message.userId === user?.id && (
                          <button
                            onClick={() => handleDeleteMessage(message.id)}
                            className="hover:text-red-300 transition-colors"
                          >
                            <X size={12} />
                          </button>
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

      {/* Input */}
      <EnhancedChatInput
        onSend={handleSendMessage}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        members={members}
        allowMentions={true}
        disabled={loading}
      />
    </div>
  );
}