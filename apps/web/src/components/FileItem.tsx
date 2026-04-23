import React, { useCallback, useState, useEffect, useRef } from 'react';
import type { Device, FileEntry } from '@localdrop/shared-types';
import { formatBytes } from '../lib/chunkedUpload';
import { getSocket } from '../lib/socket';

const base64ToUint8Array = (base64: string) => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

interface FileItemProps {
  entry: FileEntry;
  onNavigate: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  showPreview?: boolean;
  baseUrl?: string;
  device?: Device;
  isSelected?: boolean;
  onSelect?: (entry: FileEntry, selected: boolean) => void;
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
  const ext = entry.extension?.toLowerCase() || entry.name.split('.').pop()?.toLowerCase();
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
const FileItem: React.FC<FileItemProps> = React.memo(({ entry, onNavigate, onDownload, showPreview, baseUrl, device, isSelected, onSelect }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const ext = entry.extension?.toLowerCase() || entry.name.split('.').pop()?.toLowerCase();
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '');

  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPreview || !isImage || !device?.isExpoApp) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    
    return () => observer.disconnect();
  }, [showPreview, isImage, device]);

  useEffect(() => {
    if (isVisible && showPreview && isImage && device?.isExpoApp && !previewUrl && !loadingPreview) {
      setLoadingPreview(true);
      const socket = getSocket();
      const reqId = Math.random().toString(36).substring(7);
      const chunks: Uint8Array[] = [];
      
      const onChunk = (data: any) => {
        if (data.requestId === reqId) {
          chunks.push(base64ToUint8Array(data.chunk));
        }
      };
      
      socket.on(`proxy:file_download_chunk_${reqId}`, onChunk);
      socket.emit('proxy:file_download', { targetDeviceId: device.id, path: entry.path, clientRequestId: reqId, isPreview: true }, (res: any) => {
        socket.off(`proxy:file_download_chunk_${reqId}`, onChunk);
        if (!res.error) {
          const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          const blob = new Blob(chunks, { type: mimeType });
          setPreviewUrl(URL.createObjectURL(blob));
        }
        setLoadingPreview(false);
      });
      
      return () => {
        socket.off(`proxy:file_download_chunk_${reqId}`, onChunk);
      };
    }
  }, [showPreview, isImage, device, previewUrl]);

  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      onNavigate(entry);
    }
  }, [entry, onNavigate]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload(entry);
  }, [entry, onDownload]);

  const canPreviewHttp = showPreview && isImage && !device?.isExpoApp && baseUrl;
  const canPreviewWs = showPreview && isImage && device?.isExpoApp;

  return (
    <div
      ref={containerRef}
      id={`file-${entry.name}`}
      onClick={handleClick}
      className={`
        group relative flex flex-col items-center gap-3 p-4 rounded-xl transition-all duration-200 border border-white/5 bg-black/20 h-full
        ${entry.isDirectory
          ? 'cursor-pointer hover:bg-white/[0.06] hover:border-white/10'
          : `cursor-pointer hover:bg-white/[0.04] hover:border-white/10 ${isSelected ? 'border-violet-500/50 bg-violet-500/10' : ''}`
        }
      `}
      onClick={(e) => {
        if (!entry.isDirectory && onSelect) {
          onSelect(entry, !isSelected);
        } else if (entry.isDirectory) {
          handleClick();
        }
      }}
    >
      {/* Selection Checkbox */}
      {!entry.isDirectory && (
        <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
          <input 
            type="checkbox" 
            className="w-4 h-4 rounded border-gray-600 bg-black/50 text-violet-500 focus:ring-violet-500 focus:ring-offset-gray-900 cursor-pointer"
            checked={isSelected || false}
            onChange={(e) => onSelect?.(entry, e.target.checked)}
          />
        </div>
      )}

      {/* Icon or Preview */}
      <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center rounded-lg bg-black/30 overflow-hidden shadow-inner">
        {canPreviewHttp ? (
          <img 
            src={`${baseUrl}/api/files/preview?path=${encodeURIComponent(entry.path)}`} 
            alt={entry.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : canPreviewWs ? (
          previewUrl ? (
            <img 
              src={previewUrl} 
              alt={entry.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : loadingPreview ? (
            <svg className="animate-spin h-6 w-6 text-violet-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <span className="text-3xl drop-shadow-md">{getFileIcon(entry)}</span>
          )
        ) : (
          <span className="text-3xl drop-shadow-md">{getFileIcon(entry)}</span>
        )}
      </div>

      {/* Name & info */}
      <div className="flex-1 w-full text-center flex flex-col min-h-0">
        <p className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors truncate w-full px-1" title={entry.name}>
          {entry.name}
        </p>
        <div className="flex flex-col items-center gap-1 mt-1.5 opacity-80">
          {!entry.isDirectory && (
            <span className="text-xs text-gray-400 bg-black/30 px-2 py-0.5 rounded-full">{formatBytes(entry.size)}</span>
          )}
          {entry.isDirectory && entry.childCount !== undefined && (
            <span className="text-xs text-gray-400 bg-black/30 px-2 py-0.5 rounded-full">{entry.childCount} items</span>
          )}
        </div>
      </div>

      {/* Download button (files only) */}
      {!entry.isDirectory && (
        <button
          onClick={handleDownload}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-violet-500/80 hover:bg-violet-400 text-white shadow-lg backdrop-blur-sm"
          title="Download"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
      )}

      {/* Folder indicator */}
      {entry.isDirectory && (
        <div className="absolute top-2 right-2 p-1">
          <svg className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}
    </div>
  );
});

FileItem.displayName = 'FileItem';
export default FileItem;
