import React, { useCallback, useEffect } from 'react';
import type { Device, FileEntry } from '@localdrop/shared-types';
import { useFileExplorer } from '../hooks/useFileExplorer';
import { getSocket } from '../lib/socket';
import FileItem from './FileItem';

interface FileExplorerProps {
  device: Device | null;
  onDownload: (filePath: string, fileName: string) => void;
}

/** File explorer panel for browsing remote device files */
const FileExplorer: React.FC<FileExplorerProps> = ({ device, onDownload }) => {
  const { entries, currentPath, loading, error, progress, navigate, goUp, goToFolder, breadcrumbs } =
    useFileExplorer(device);

  const [downloadProgress, setDownloadProgress] = React.useState<{ name: string; loaded: number; total: number } | null>(null);
  const [showPreview, setShowPreview] = React.useState(false);
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(new Set());
  
  const baseUrl = device ? `http://${device.ip}:${device.port}` : '';

  // Clear selection on navigate
  useEffect(() => {
    setSelectedPaths(new Set());
  }, [currentPath]);

  const handleSelect = useCallback((entry: FileEntry, selected: boolean) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (selected) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
  }, []);

  const filesCount = entries.filter(e => !e.isDirectory).length;

  const handleSelectAll = useCallback(() => {
    if (selectedPaths.size === filesCount && filesCount > 0) {
      setSelectedPaths(new Set());
    } else {
      const allFilePaths = entries.filter(e => !e.isDirectory).map(e => e.path);
      setSelectedPaths(new Set(allFilePaths));
    }
  }, [entries, selectedPaths.size, filesCount]);

  // Navigate to root when device changes
  useEffect(() => {
    if (device) navigate('.');
  }, [device?.id]);

  if (!device) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="text-6xl mb-4 animate-float">📂</div>
        <h3 className="text-lg font-semibold text-white mb-2">No Device Selected</h3>
        <p className="text-sm text-gray-500 max-w-xs">
          Select a device from the sidebar to browse its shared files
        </p>
      </div>
    );
  }

  if (device.isWebClient) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-white/[0.01]">
        <div className="text-6xl mb-4 animate-float">📱</div>
        <h3 className="text-lg font-semibold text-white mb-2">Web Browser Client</h3>
        <p className="text-sm text-gray-400 max-w-sm leading-relaxed">
          This device is connected via a web browser and cannot host files to browse.
        </p>
        <div className="mt-6 p-4 rounded-xl bg-violet-500/10 border border-violet-500/20 text-left max-w-sm">
          <p className="text-sm text-violet-200 font-medium mb-1">How to send files?</p>
          <p className="text-xs text-violet-300/80">
            To send files <b>from your PC to this mobile</b>, open this page on the mobile browser, select your PC, and download the files you want!
          </p>
        </div>
      </div>
    );
  }

  const base64ToUint8Array = (base64: string) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const handleDownload = (entry: FileEntry) => {
    if (device.isExpoApp) {
      setDownloadProgress({ name: entry.name, loaded: 0, total: entry.size });
      const socket = getSocket();
      const reqId = Math.random().toString(36).substring(7);
      const chunks: Uint8Array[] = [];
      let currentLoaded = 0;
      
      const onChunk = (data: any) => {
        const bytes = base64ToUint8Array(data.chunk);
        chunks.push(bytes);
        currentLoaded += data.chunk.length; // rough estimate based on base64 len
        setDownloadProgress({ name: entry.name, loaded: currentLoaded, total: data.totalSize * 1.33 }); // account for base64 inflation
      };
      
      socket.on(`proxy:file_download_chunk_${reqId}`, onChunk);
      socket.emit('proxy:file_download', { targetDeviceId: device.id, path: entry.path, clientRequestId: reqId }, (res: any) => {
        socket.off(`proxy:file_download_chunk_${reqId}`, onChunk);
        if (res.error) {
          setDownloadProgress(null);
          return alert('Download failed: ' + res.error);
        }
        
        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = entry.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        setDownloadProgress(null);
      });
    } else {
      onDownload(entry.path, entry.name);
    }
  };

  const handleDownloadSelected = () => {
    const selectedEntries = entries.filter(e => selectedPaths.has(e.path));
    selectedEntries.forEach(entry => handleDownload(entry));
    setSelectedPaths(new Set());
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Breadcrumb navigation */}
      <div className="px-5 py-3 border-b border-white/5 flex items-center gap-1 overflow-x-auto">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={crumb.path}>
            {i > 0 && (
              <svg className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            <button
              onClick={() => navigate(crumb.path)}
              className={`text-xs px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                i === breadcrumbs.length - 1
                  ? 'text-white bg-white/5 font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {crumb.name}
            </button>
          </React.Fragment>
        ))}

      {/* Main dropzone for PC -> Mobile uploads */}
        <button
          onClick={() => setShowPreview(!showPreview)}
          className={`ml-auto p-1.5 rounded-lg transition-colors cursor-pointer mr-2 ${showPreview ? 'text-violet-400 bg-violet-500/20' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
          title="Preview Images"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>

        {/* Select All button */}
        <button
          onClick={handleSelectAll}
          className={`ml-2 p-1.5 rounded-lg transition-colors cursor-pointer mr-2 ${selectedPaths.size > 0 && selectedPaths.size === filesCount ? 'text-violet-400 bg-violet-500/20' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
          title="Select All Files"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        {/* Refresh button */}
        <button
          onClick={() => navigate(currentPath)}
          className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Selection Action Bar */}
      {selectedPaths.size > 0 && (
        <div className="px-5 py-2 bg-violet-500/10 border-b border-violet-500/20 flex items-center gap-3 animate-slide-up z-10 relative" style={{ animationDuration: '200ms' }}>
          <span className="text-sm font-medium text-violet-300">
            {selectedPaths.size} file{selectedPaths.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleDownloadSelected}
            className="ml-auto px-3 py-1.5 bg-violet-500 hover:bg-violet-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 shadow-lg cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Selected
          </button>
        </div>
      )}
      
      {/* Download Progress Overlay */}
      {downloadProgress && (
        <div className="absolute top-14 left-0 right-0 z-10 bg-violet-900/90 backdrop-blur-sm border-b border-violet-500/30 p-3 flex flex-col items-center justify-center">
          <p className="text-xs text-violet-100 font-medium mb-2 truncate max-w-[80%]">Downloading: {downloadProgress.name}</p>
          <div className="w-full max-w-sm h-1.5 bg-black/50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-violet-400 transition-all duration-200 ease-out rounded-full" 
              style={{ width: `${Math.min(100, Math.round((downloadProgress.loaded / (downloadProgress.total || 1)) * 100))}%` }} 
            />
          </div>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-2 relative">
        {error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : entries.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-sm text-gray-400">This folder is empty</p>
          </div>
        ) : (
          <>
            {loading && entries.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="flex items-center gap-3 mb-4">
                  <svg className="animate-spin h-5 w-5 text-violet-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm text-gray-400">Loading files...</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-2">
              {entries.map((entry, i) => (
                <div
                  key={entry.path}
                  className="animate-slide-up"
                  style={{ animationDelay: `${(i % 20) * 10}ms`, animationFillMode: 'backwards' }}
                >
                  <FileItem
                    entry={entry}
                    onNavigate={goToFolder}
                    onDownload={handleDownload}
                    showPreview={showPreview}
                    baseUrl={baseUrl}
                    device={device}
                    isSelected={selectedPaths.has(entry.path)}
                    onSelect={handleSelect}
                  />
                </div>
              ))}
            </div>
            {loading && progress && progress.total > 0 && (
              <div className="sticky bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-xs text-center bg-black/80 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-xl z-20">
                <div className="flex justify-between text-xs text-gray-300 mb-1.5">
                  <span>Reading files</span>
                  <span>{progress.loaded} / {progress.total}</span>
                </div>
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-violet-500 transition-all duration-300 rounded-full" 
                    style={{ width: `${Math.round((progress.loaded / progress.total) * 100)}%` }} 
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
