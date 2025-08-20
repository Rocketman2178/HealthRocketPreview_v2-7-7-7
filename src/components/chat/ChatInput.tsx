import React, { useState, useRef, useEffect } from 'react';
import { Send, Image, Smile, X } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import type { ChatMessage } from '../../types/chat';

interface ChatInputProps {
  onSend: (content: string, mediaFile?: File) => void;
  disabled?: boolean;
  showVerificationToggle?: boolean;
  replyingTo?: ChatMessage;
  onCancelReply?: () => void;
  placeholder?: string;
}

export function ChatInput({ 
  onSend, 
  disabled = false, 
  showVerificationToggle = false,
  replyingTo,
  onCancelReply,
  placeholder = "Type a message..."
}: ChatInputProps) {
  const [content, setContent] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [isVerification, setIsVerification] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !mediaFile) return;

    onSend(content, mediaFile);
    setContent('');
    setMediaFile(null);
    setIsVerification(false);
    setShowEmojiPicker(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMediaFile(file);
    }
  };

  const handleEmojiClick = (emojiData: any) => {
    setContent(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const removeMediaFile = () => {
    setMediaFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="relative">
      {/* Emoji Picker */}
      {showEmojiPicker && (
        <div ref={emojiPickerRef} className="absolute bottom-full mb-2 right-0 z-50">
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            theme="dark"
            width={300}
            height={400}
          />
        </div>
      )}

      {/* Reply indicator */}
      {replyingTo && (
        <div className="flex items-center justify-between p-2 bg-gray-700/50 rounded-t-lg border-b border-gray-600">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Replying to</span>
            <span className="text-xs text-white font-medium">{replyingTo.user_name}</span>
            <span className="text-xs text-gray-400 truncate max-w-32">
              {replyingTo.content.substring(0, 50)}...
            </span>
          </div>
          <button
            onClick={onCancelReply}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Verification toggle - only show when showVerificationToggle is true */}
      {showVerificationToggle === true && (
        <div className="flex items-center gap-2 p-3 bg-gray-700/30">
          <input
            type="checkbox"
            id="verification-toggle"
            checked={isVerification}
            onChange={(e) => setIsVerification(e.target.checked)}
            className="w-4 h-4 text-orange-500 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
          />
          <label htmlFor="verification-toggle" className="text-sm text-gray-300">
            Mark as verification post
          </label>
        </div>
      )}

      {/* Media preview */}
      {mediaFile && (
        <div className="p-3 bg-gray-700/30 border-b border-gray-600">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image size={16} className="text-gray-400" />
              <span className="text-sm text-gray-300">{mediaFile.name}</span>
            </div>
            <button
              onClick={removeMediaFile}
              className="text-gray-400 hover:text-red-400 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2 p-3">
        <div className="flex-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
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

          {/* Media upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-orange-500 transition-colors"
            title="Upload image"
          >
            <Image size={20} />
          </button>

          {/* Send button */}
          <button
            type="submit"
            disabled={disabled || (!content.trim() && !mediaFile)}
            className="p-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={20} />
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </form>
    </div>
  );
}