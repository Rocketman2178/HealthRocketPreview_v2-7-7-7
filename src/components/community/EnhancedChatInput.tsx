import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Image, 
  Smile,
  X,
  User
} from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';

interface EnhancedChatInputProps {
  onSend: (content: string, mediaFile?: File) => void;
  disabled?: boolean;
  replyingTo?: any;
  onCancelReply?: () => void;
  members?: Array<{id: string; name: string; avatarUrl?: string}>;
  allowMentions?: boolean;
}

export function EnhancedChatInput({
  onSend,
  disabled = false,
  replyingTo,
  onCancelReply,
  members = [],
  allowMentions = false
}: EnhancedChatInputProps) {
  const [content, setContent] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter members based on mention query
  const filteredMembers = members.filter(member =>
    member.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

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

  // Handle mention detection
  const handleContentChange = (value: string) => {
    setContent(value);
    
    if (!allowMentions) return;
    
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !mediaFile) return;

    onSend(content, mediaFile);
    setContent('');
    setMediaFile(null);
    setShowMentions(false);
    setMentionQuery('');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMediaFile(file);
    }
  };

  const handleEmojiClick = (emojiData: any) => {
    setContent(prev => prev + emojiData.emoji);
    // Don't close the emoji picker - let user select multiple emojis
  };

  const removeMediaFile = () => {
    setMediaFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMentionSelect = (member: { id: string; name: string }) => {
    if (mentionStartIndex === -1) return;
    
    const beforeMention = content.slice(0, mentionStartIndex);
    const afterMention = content.slice(mentionStartIndex + 1 + mentionQuery.length);
    const newContent = `${beforeMention}@${member.name} ${afterMention}`;
    
    setContent(newContent);
    setShowMentions(false);
    setMentionQuery('');
    
    // Focus back to textarea
    textareaRef.current?.focus();
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

      {/* Mentions Dropdown */}
      {showMentions && allowMentions && filteredMembers.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-32 overflow-y-auto min-w-48 z-50">
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
        <div className="flex items-center justify-between p-2 bg-gray-700/50 rounded-t-lg border-b border-gray-600">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Replying to {replyingTo.userName}</span>
            <span className="text-xs text-gray-400 truncate max-w-32">
              {replyingTo.content.substring(0, 50)}...
            </span>
          </div>
          <button
            onClick={onCancelReply}
            className="text-gray-400 hover:text-white"
          >
            <X size={16} />
          </button>
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
            ref={textareaRef}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="Type a message..."
            disabled={disabled}
            rows={1}
            className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
              if (e.key === 'Escape') {
                setShowEmojiPicker(false);
                setShowMentions(false);
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