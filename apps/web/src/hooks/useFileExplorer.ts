import { useState, useCallback } from 'react';
import type { FileEntry, FileListResponse } from '@localdrop/shared-types';

/** Hook to browse files on a remote device */
export function useFileExplorer(baseUrl: string = '') {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback(async (dirPath: string = '.') => {
    setLoading(true);
    setError(null);
    try {
      const url = `${baseUrl}/api/files/list?path=${encodeURIComponent(dirPath)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to list directory: ${res.statusText}`);
      const data: FileListResponse = await res.json();
      setEntries(data.entries);
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
    } catch (err: any) {
      setError(err.message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

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
    entries, currentPath, parentPath, loading, error,
    navigate, goUp, goToFolder, refresh, breadcrumbs,
  };
}
