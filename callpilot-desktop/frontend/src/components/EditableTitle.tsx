'use client';

import { useRef, useEffect } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

interface EditableTitleProps {
  title: string;
  isEditing: boolean;
  onStartEditing: () => void;
  onFinishEditing: () => void;
  onChange: (value: string) => void;
  onDelete?: () => void;
}

export const EditableTitle: React.FC<EditableTitleProps> = ({
  title,
  isEditing,
  onStartEditing,
  onFinishEditing,
  onChange,
  onDelete,
}) => {
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onFinishEditing();
    }
  };

  // Auto-resize textarea height based on content
  useEffect(() => {
    if (titleInputRef.current && isEditing) {
      titleInputRef.current.style.height = 'auto';
      titleInputRef.current.style.height = `${titleInputRef.current.scrollHeight}px`;
    }
  }, [title, isEditing]);

  return isEditing ? (
    <div className="flex-1">
      <textarea
        ref={titleInputRef}
        value={title}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onFinishEditing}
        onKeyDown={(e) => {
          // Allow Enter for new line only with Shift key
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onFinishEditing();
          }
        }}
        className="text-2xl font-bold bg-[var(--opaline-surface-container-low)] border border-[var(--opaline-outline-variant)] focus:outline-none focus:ring-2 focus:ring-ring rounded px-3 py-1 w-full resize-none overflow-hidden"
        style={{ minWidth: '300px', minHeight: '40px' }}
        autoFocus
        rows={1}
      />
    </div>
  ) : (
    <div className="group flex items-center space-x-2 flex-1">
      <h1
        className="text-2xl font-bold cursor-pointer hover:bg-[var(--opaline-surface-container-low)] rounded px-1 flex-1 whitespace-pre-wrap"
        onClick={onStartEditing}
      >
        {title}
      </h1>
      <div className="flex space-x-1">
        <button 
          onClick={onStartEditing}
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-[var(--opaline-surface-container-low)] rounded text-[var(--opaline-on-surface-variant)] focus-ring"
          title="Edit section title"
        >
          <Pencil className="w-4 h-4" />
        </button>
        {onDelete && (
          <button 
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-[var(--opaline-surface-container-low)] rounded text-danger focus-ring"
            title="Delete section"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
