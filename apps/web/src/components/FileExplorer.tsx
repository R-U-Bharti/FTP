import React, { useEffect } from 'react';
import type { Device, FileEntry } from '@localdrop/shared-types';
import { useFileExplorer } from '../hooks/useFileExplorer';
import FileItem from './FileItem';

interface FileExplorerProps {
  device: Device | null;
  onDownload: (filePath: string, fileName: string) => void;
}

/** File explorer panel for browsing remote device files */
const FileExplorer: React.FC<FileExplorerProps> = ({ device, onDownload }) => {
  const baseUrl = device ? `http://${device.ip}:${device.port}` : '';
  const { entries, currentPath, loading, error, navigate, goUp, goToFolder, breadcrumbs } =
    useFileExplorer(baseUrl);

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

  const handleDownload = (entry: FileEntry) => {
    onDownload(entry.path, entry.name);
  };

  return (
    <div className="flex flex-col h-full">
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

        {/* Refresh button */}
        <button
          onClick={() => navigate(currentPath)}
          className="ml-auto p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-violet-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-gray-400">Loading files...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-sm text-gray-400">This folder is empty</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry, i) => (
              <div
                key={entry.path}
                className="animate-slide-up"
                style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'backwards' }}
              >
                <FileItem
                  entry={entry}
                  onNavigate={goToFolder}
                  onDownload={handleDownload}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
