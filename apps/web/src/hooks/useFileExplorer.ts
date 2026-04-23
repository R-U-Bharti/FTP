import { useState, useCallback } from 'react';
import type { Device, FileEntry, FileListResponse } from '@localdrop/shared-types';
import { getSocket } from '../lib/socket';

export interface FileExplorerProgress {
  loaded: number;
  total: number;
}

/** Hook to browse files on a remote device */
export function useFileExplorer(device: Device | null) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FileExplorerProgress | null>(null);

  const navigate = useCallback(async (dirPath: string = '.') => {
    if (!device) return;
    
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      if (device.isExpoApp) {
        // Use WebSocket proxy for Expo App
        const socket = getSocket();
        
        const data = await new Promise<FileListResponse>((resolve, reject) => {
          // Send request but let handler.ts generate requestId, or we generate it? 
          // handler.ts generates the requestId! Oh wait. If handler.ts generates requestId, 
          // how does PC web know what event to listen to?
          // Ah! handler.ts doesn't return the requestId to the callback until it finishes!
          // We must send our OWN requestId so we can listen to progress!
          const reqId = Math.random().toString(36).substring(7);
          
          const onProgress = (prog: any) => {
            setProgress({ loaded: prog.loaded, total: prog.total });
            if (prog.partialEntries) {
              setEntries(prog.partialEntries);
            }
          };
          socket.on(`proxy:file_list_progress_${reqId}`, onProgress);
          
          socket.emit('proxy:file_list', { targetDeviceId: device.id, path: dirPath, clientRequestId: reqId }, (res: any) => {
            socket.off(`proxy:file_list_progress_${reqId}`, onProgress);
            if (res.error) reject(new Error(res.error));
            else resolve({ entries: res.entries, currentPath: dirPath, parentPath: dirPath === '.' ? null : dirPath.split('/').slice(0, -1).join('/') || '.' });
          });
        });
        
        setEntries(data.entries || []);
        setCurrentPath(data.currentPath);
        setParentPath(data.parentPath);
      } else {
        // Use HTTP for Node.js server
        const baseUrl = `http://${device.ip}:${device.port}`;
        const url = `${baseUrl}/api/files/list?path=${encodeURIComponent(dirPath)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to list directory: ${res.statusText}`);
        const data: FileListResponse = await res.json();
        setEntries(data.entries);
        setCurrentPath(data.currentPath);
        setParentPath(data.parentPath);
      }
    } catch (err: any) {
      setError(err.message);
      setEntries([]);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [device]);

  const goUp = useCallback(() => {
    if (parentPath !== null) navigate(parentPath);
  }, [parentPath, navigate]);

  const goToFolder = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) navigate(entry.path);
  }, [navigate]);

  const refresh = useCallback(() => {
    navigate(currentPath);
  }, [currentPath, navigate]);

  // Build breadcrumb parts from current path
  const breadcrumbs = currentPath === '.'
    ? [{ name: 'Home', path: '.' }]
    : [
        { name: 'Home', path: '.' },
        ...currentPath.split('/').map((part, i, arr) => ({
          name: part,
          path: arr.slice(0, i + 1).join('/'),
        })),
      ];

  return {
    entries, currentPath, parentPath, loading, error, progress,
    navigate, goUp, goToFolder, refresh, breadcrumbs,
  };
}
