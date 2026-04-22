import React, { useCallback } from 'react';
import type { FileEntry } from '@localdrop/shared-types';
import { formatBytes } from '../lib/chunkedUpload';

interface FileItemProps {
  entry: FileEntry;
  onNavigate: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
}

/** File type to icon mapping */
const fileIcons: Record<string, string> = {
  folder: '📁',
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  pdf: '📄',
  zip: '📦',
  code: '💻',
  text: '📝',
  default: '📋',
};

function getFileIcon(entry: FileEntry): string {
  if (entry.isDirectory) return fileIcons.folder;
  const ext = entry.extension?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext || '')) return fileIcons.image;
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext || '')) return fileIcons.video;
  if (['mp3', 'wav', 'flac', 'ogg', 'aac'].includes(ext || '')) return fileIcons.audio;
  if (ext === 'pdf') return fileIcons.pdf;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext || '')) return fileIcons.zip;
  if (['js', 'ts', 'py', 'java', 'cpp', 'html', 'css', 'json'].includes(ext || '')) return fileIcons.code;
  if (['txt', 'md', 'doc', 'docx'].includes(ext || '')) return fileIcons.text;
  return fileIcons.default;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Single file/folder row in the file explorer */
const FileItem: React.FC<FileItemProps> = React.memo(({ entry, onNavigate, onDownload }) => {
  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      onNavigate(entry);
    }
  }, [entry, onNavigate]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload(entry);
  }, [entry, onDownload]);

  return (
    <div
      id={`file-${entry.name}`}
      onClick={handleClick}
      className={`
        group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
        ${entry.isDirectory
          ? 'cursor-pointer hover:bg-white/[0.04]'
          : 'hover:bg-white/[0.03]'
        }
      `}
    >
      {/* Icon */}
      <span className="text-xl flex-shrink-0">{getFileIcon(entry)}</span>

      {/* Name & info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200 truncate group-hover:text-white transition-colors">
          {entry.name}
        </p>
        <div className="flex items-center gap-3 mt-0.5">
          {!entry.isDirectory && (
            <span className="text-xs text-gray-500">{formatBytes(entry.size)}</span>
          )}
          {entry.isDirectory && entry.childCount !== undefined && (
            <span className="text-xs text-gray-500">{entry.childCount} items</span>
          )}
          <span className="text-xs text-gray-600">{formatDate(entry.modifiedAt)}</span>
        </div>
      </div>

      {/* Download button (files only) */}
      {!entry.isDirectory && (
        <button
          onClick={handleDownload}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg hover:bg-violet-500/20 text-violet-400 hover:text-violet-300"
          title="Download"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
      )}

      {/* Folder arrow */}
      {entry.isDirectory && (
        <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  );
});

FileItem.displayName = 'FileItem';
export default FileItem;
