import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, Users, AlertTriangle, Loader2, User, X, Image, Smile } from 'lucide-react';
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

  // Subscribe to new messages
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
        newMessage.trim()
      );

      setNewMessage('');
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
  }, [newMessage, primaryCommunity?.id, user, sending, onError]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

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
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.userId === user?.id ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg p-3 ${
                    message.userId === user?.id
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-700 text-gray-100'
                  }`}
                >
                  {message.userId !== user?.id && (
                    <div className="text-xs text-orange-400 mb-1 font-medium">
                      {message.userName}
                    </div>
                  )}
                  <div className="text-sm">{message.content}</div>
                  <div className="text-xs opacity-75 mt-1">
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
            ))}
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
            placeholder="Type a message..."
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