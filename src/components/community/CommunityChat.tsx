import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, User, X, Reply, AlertTriangle } from 'lucide-react';
import { useSupabase } from '../../contexts/SupabaseContext';
import { useCommunity } from '../../hooks/useCommunity';
import { supabase } from '../../lib/supabase';

interface CommunityMessage {
  id: string;
  community_id: string;
  user_id: string;
  content: string;
  media_url?: string;
  media_type?: 'image' | 'video';
  parent_message_id?: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_avatar_url?: string;
}

interface CommunityChatProps {
  onError?: (error: Error) => void;
}

export function CommunityChat({ onError }: CommunityChatProps) {
  const { user } = useSupabase();
  const { primaryCommunity } = useCommunity(user?.id);
  
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Load messages
  useEffect(() => {
    if (!primaryCommunity?.id || !user) {
      setLoading(false);
      return;
    }

    const loadMessages = async () => {
      try {
        setLoading(true);
        setError(null);

        // Use the RPC function instead of edge function
        const { data, error } = await supabase.rpc('get_community_chat_messages', {
          p_community_id: primaryCommunity.id,
          p_limit: 50,
          p_offset: 0
        });

        if (error) throw error;

        if (!data || !Array.isArray(data)) {
          setMessages([]);
          return;
        }

        // Transform and sort messages
        const transformedMessages = data
          .map(msg => ({
            id: msg.id,
            community_id: msg.community_id,
            user_id: msg.user_id,
            content: msg.content,
            media_url: msg.media_url,
            media_type: msg.media_type,
            parent_message_id: msg.parent_message_id,
            reply_count: msg.reply_count || 0,
            created_at: msg.created_at,
            updated_at: msg.updated_at,
            user_name: msg.user_name || 'Unknown User',
            user_avatar_url: msg.user_avatar_url
          }))
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        setMessages(transformedMessages);

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

    loadMessages();
  }, [primaryCommunity?.id, user, onError]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !primaryCommunity?.id || !newMessage.trim() || sending) return;

    try {
      setSending(true);
      setError(null);

      // Get user details first
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('name, avatar_url')
        .eq('id', user.id)
        .single();

      if (userError) throw userError;

      // Insert the message directly
      const { data: insertedMessage, error: insertError } = await supabase
        .from('community_chat_messages')
        .insert({
          user_id: user.id,
          community_id: primaryCommunity.id,
          content: newMessage.trim(),
          parent_message_id: replyingTo?.id,
          user_name: userData.name || 'Unknown User'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Add message to local state immediately for better UX
      const messageToAdd: CommunityMessage = {
        id: insertedMessage.id,
        community_id: insertedMessage.community_id,
        user_id: insertedMessage.user_id,
        content: insertedMessage.content,
        media_url: insertedMessage.media_url,
        media_type: insertedMessage.media_type,
        parent_message_id: insertedMessage.parent_message_id,
        reply_count: 0,
        created_at: insertedMessage.created_at,
        updated_at: insertedMessage.updated_at,
        user_name: userData.name || 'Unknown User',
        user_avatar_url: userData.avatar_url
      };

      setMessages(prev => {
        // Prevent duplicates
        if (prev.some(msg => msg.id === messageToAdd.id)) {
          return prev;
        }
        return [...prev, messageToAdd];
      });

      // Clear form
      setNewMessage('');
      setReplyingTo(null);

    } catch (err) {
      console.error('Error sending message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('community_chat_messages')
        .delete()
        .eq('id', messageId)
        .eq('user_id', user.id);

      if (error) throw error;

      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  };

  // Subscribe to new messages
  useEffect(() => {
    if (!primaryCommunity?.id || !user) return;

    const channel = supabase
      .channel(`community_chat_${primaryCommunity.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'community_chat_messages',
          filter: `community_id=eq.${primaryCommunity.id}`
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
              console.error('Error fetching user data for new message:', userError);
              return;
            }

            const message: CommunityMessage = {
              id: payload.new.id,
              community_id: payload.new.community_id,
              user_id: payload.new.user_id,
              content: payload.new.content,
              media_url: payload.new.media_url,
              media_type: payload.new.media_type,
              parent_message_id: payload.new.parent_message_id,
              reply_count: payload.new.reply_count || 0,
              created_at: payload.new.created_at,
              updated_at: payload.new.updated_at,
              user_name: userData.name || 'Unknown User',
              user_avatar_url: userData.avatar_url
            };

            setMessages(prev => {
              // Prevent duplicates
              if (prev.some(msg => msg.id === message.id)) {
                return prev;
              }
              return [...prev, message];
            });
          } catch (err) {
            console.error('Error processing real-time message:', err);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'community_chat_messages',
          filter: `community_id=eq.${primaryCommunity.id}`
        },
        (payload) => {
          setMessages(prev => prev.filter(msg => msg.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [primaryCommunity?.id, user]);

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
            <p className="text-sm text-gray-400">Community Chat</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="h-[400px] overflow-y-auto p-4 space-y-4">
        {/* Reply indicator */}
        {replyingTo && (
          <div className="bg-gray-700/50 p-2 rounded-lg border-l-4 border-orange-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Reply size={14} className="text-orange-500" />
                <span className="text-xs text-gray-400">
                  Replying to {replyingTo.user_name}
                </span>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-gray-300 mt-1 truncate">
              {replyingTo.content}
            </p>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <MessageCircle className="mx-auto mb-2" size={24} />
            <p>No messages yet</p>
            <p className="text-sm text-gray-500 mt-1">Be the first to start the conversation!</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.user_id === user?.id ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] inline-block ${message.user_id === user?.id ? 'order-2' : 'order-1'}`}>
                {/* Avatar and name for other users */}
                {message.user_id !== user?.id && (
                  <div className="flex items-center gap-2 mb-1">
                    {message.user_avatar_url ? (
                      <img
                        src={message.user_avatar_url}
                        alt={message.user_name}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center">
                        <User size={12} className="text-gray-400" />
                      </div>
                    )}
                    <span className="text-xs text-orange-500 font-medium">
                      {message.user_name}
                    </span>
                  </div>
                )}

                {/* Message bubble */}
                <div
                  className={`px-3 py-2 rounded-lg ${
                    message.user_id === user?.id
                      ? 'bg-orange-500 text-white rounded-br-none'
                      : 'bg-gray-700 text-white rounded-bl-none'
                  }`}
                >
                  {/* Media */}
                  {message.media_url && (
                    <div className="mb-2">
                      {message.media_type === 'image' ? (
                        <img
                          src={message.media_url}
                          alt="Message attachment"
                          className="max-w-full h-auto rounded"
                        />
                      ) : (
                        <video
                          src={message.media_url}
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
                      {new Date(message.created_at).toLocaleDateString('en-US', {
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
                        onClick={() => setReplyingTo(message)}
                        className="hover:text-orange-300 transition-colors"
                      >
                        <Reply size={12} />
                      </button>
                      
                      {/* Delete button for own messages */}
                      {message.user_id === user?.id && (
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
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-700">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message or use @ to mention a user"
              disabled={sending}
              rows={1}
              className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
            />
          </div>

          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="p-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </div>
  );
}