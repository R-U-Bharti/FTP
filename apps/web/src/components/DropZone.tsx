import React, { useCallback, useState, useRef } from 'react';
import { Button } from '@localdrop/ui';

interface DropZoneProps {
  onFilesDropped: (files: File[]) => void;
  disabled?: boolean;
}

/** Drag & drop zone for file uploads with visual feedback */
const DropZone: React.FC<DropZoneProps> = ({ onFilesDropped, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFilesDropped(files);
  }, [onFilesDropped]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onFilesDropped(files);
    e.target.value = ''; // Reset so same file can be selected again
  }, [onFilesDropped]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`
        relative rounded-2xl border-2 border-dashed transition-all duration-300 p-8
        ${isDragging
          ? 'border-violet-400 bg-violet-500/10 scale-[1.02]'
          : 'border-white/10 hover:border-white/20 bg-white/[0.01]'
        }
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      <div className="flex flex-col items-center justify-center text-center">
        <div className={`text-4xl mb-3 transition-transform duration-300 ${isDragging ? 'scale-125 animate-float' : ''}`}>
          {isDragging ? '📥' : '📤'}
        </div>

        <p className="text-sm text-gray-300 mb-1">
          {isDragging ? 'Drop files here!' : 'Drag & drop files to upload'}
        </p>
        <p className="text-xs text-gray-500 mb-4">or</p>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          Browse Files
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
};

export default DropZone;
