import { useState, useCallback, startTransition, useMemo } from 'react';
import type { Device, FileEntry, FileListResponse } from '@localdrop/shared-types';
import { getSocket } from '../lib/socket';

export interface FileExplorerProgress {
  loaded: number;
  total: number;
}

const folderCache = new Map<string, { entries: FileEntry[], parentPath: string | null }>();

/** Hook to browse files on a remote device */
export function useFileExplorer(device: Device | null) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FileExplorerProgress | null>(null);

  const navigate = useCallback(async (dirPath: string = '.', forceRefresh = false) => {
    if (!device) return;
    
    const cacheKey = `${device.id}:${dirPath}`;
    const cached = folderCache.get(cacheKey);

    // Instant UI transition
    startTransition(() => {
      setCurrentPath(dirPath);
      setParentPath(dirPath === '.' ? null : dirPath.split('/').slice(0, -1).join('/') || '.');
      
      if (!forceRefresh && cached) {
        setEntries(cached.entries);
        setLoading(false);
      } else {
        setEntries([]); // Clear entries for skeleton loading
        setLoading(true);
      }
    });
    
    if (!forceRefresh && cached) return;

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
        
        startTransition(() => {
          setEntries(data.entries || []);
        });
        folderCache.set(cacheKey, { entries: data.entries || [], parentPath: data.parentPath });
      } else {
        // Use HTTP for Node.js server
        const baseUrl = `http://${device.ip}:${device.port}`;
        const url = `${baseUrl}/api/files/list?path=${encodeURIComponent(dirPath)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to list directory: ${res.statusText}`);
        const data: FileListResponse = await res.json();
        startTransition(() => {
          setEntries(data.entries);
        });
        folderCache.set(cacheKey, { entries: data.entries, parentPath: data.parentPath });
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
    navigate(currentPath, true);
  }, [currentPath, navigate]);

  // Build breadcrumb parts from current path
  const breadcrumbs = useMemo(() => {
    if (currentPath === '.') return [{ name: 'Home', path: '.' }];
    
    const parts = currentPath.split('/');
    const crumbs = [{ name: 'Home', path: '.' }];
    
    // For absolute URIs, we skip the protocol and root segments that are usually restricted
    // (e.g. file:///storage/emulated/0 -> skip file:, empty strings, storage, emulated)
    let startIndex = 0;
    if (currentPath.startsWith('file:///storage/emulated/0')) {
      startIndex = 6; // Skip file:, "", "", storage, emulated, 0
    } else if (currentPath.startsWith('content://')) {
      // For SAF, breadcrumbs are very complex, let's just show the last few parts or nothing
      startIndex = parts.length - 1; 
    }

    for (let i = startIndex; i < parts.length; i++) {
      if (!parts[i]) continue;
      crumbs.push({
        name: decodeURIComponent(parts[i]),
        path: parts.slice(0, i + 1).join('/')
      });
    }
    
    return crumbs;
  }, [currentPath]);

  return {
    entries, currentPath, parentPath, loading, error, progress,
    navigate, goUp, goToFolder, refresh, breadcrumbs,
  };
}
