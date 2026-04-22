import { useState, useCallback, useEffect } from 'react';
import type { Transfer } from '@localdrop/shared-types';
import { chunkedUpload } from '../lib/chunkedUpload';
import { streamDownload } from '../lib/streamDownload';
import { getSocket } from '../lib/socket';

interface LocalTransfer extends Transfer {
  abortController?: AbortController;
}

/** Hook to manage file uploads and downloads with progress tracking */
export function useFileTransfer(baseUrl: string = '') {
  const [transfers, setTransfers] = useState<LocalTransfer[]>([]);

  // Listen for server-side transfer events
  useEffect(() => {
    const socket = getSocket();

    socket.on('transfer:progress', (transfer: Transfer) => {
      setTransfers((prev) => {
        const idx = prev.findIndex((t) => t.id === transfer.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx]!, ...transfer };
          return updated;
        }
        return [...prev, transfer];
      });
    });

    socket.on('transfer:complete', (transfer: Transfer) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transfer.id ? { ...t, ...transfer, status: 'completed' as const } : t
        )
      );
    });

    socket.on('transfer:error', (transfer: Transfer) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transfer.id ? { ...t, ...transfer, status: 'failed' as const } : t
        )
      );
    });

    return () => {
      socket.off('transfer:progress');
      socket.off('transfer:complete');
      socket.off('transfer:error');
    };
  }, []);

  /** Upload a file using chunked upload */
  const uploadFile = useCallback(
    (file: File, targetPath: string = '.') => {
      const transferId = crypto.randomUUID();
      const abortController = new AbortController();

      const transfer: LocalTransfer = {
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred: 0,
        progress: 0,
        speed: 0,
        eta: 0,
        status: 'transferring',
        direction: 'upload',
        method: 'http',
        remoteDeviceId: 'self',
        remoteDeviceName: 'This Device',
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [...prev, transfer]);

      chunkedUpload({
        file,
        transferId,
        targetUrl: baseUrl,
        targetPath,
        signal: abortController.signal,
        onProgress: (progress, speed, eta) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? { ...t, progress, speed, eta, bytesTransferred: (progress / 100) * file.size, status: 'transferring' as const }
                : t
            )
          );
        },
        onComplete: () => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? { ...t, status: 'completed' as const, progress: 100, completedAt: Date.now() }
                : t
            )
          );
        },
        onError: (error) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? { ...t, status: 'failed' as const, error }
                : t
            )
          );
        },
      });

      return transferId;
    },
    [baseUrl]
  );

  /** Download a file using streaming fetch */
  const downloadFile = useCallback(
    (filePath: string, fileName: string) => {
      const transferId = crypto.randomUUID();
      const abortController = new AbortController();

      const transfer: LocalTransfer = {
        id: transferId,
        fileName,
        fileSize: 0,
        bytesTransferred: 0,
        progress: 0,
        speed: 0,
        eta: 0,
        status: 'transferring',
        direction: 'download',
        method: 'http',
        remoteDeviceId: 'remote',
        remoteDeviceName: 'Remote Device',
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [...prev, transfer]);

      streamDownload({
        url: `${baseUrl}/api/files/download?path=${encodeURIComponent(filePath)}`,
        fileName,
        signal: abortController.signal,
        onProgress: (progress, speed, eta) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? { ...t, progress, speed, eta, status: 'transferring' as const }
                : t
            )
          );
        },
        onComplete: () => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? { ...t, status: 'completed' as const, progress: 100, completedAt: Date.now() }
                : t
            )
          );
        },
        onError: (error) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.id === transferId
                ? { ...t, status: 'failed' as const, error }
                : t
            )
          );
        },
      });

      return transferId;
    },
    [baseUrl]
  );

  /** Cancel a transfer */
  const cancelTransfer = useCallback((transferId: string) => {
    setTransfers((prev) =>
      prev.map((t) => {
        if (t.id === transferId && t.abortController) {
          t.abortController.abort();
          return { ...t, status: 'cancelled' as const };
        }
        return t;
      })
    );
  }, []);

  /** Clear completed/failed transfers */
  const clearCompleted = useCallback(() => {
    setTransfers((prev) =>
      prev.filter((t) => t.status === 'transferring' || t.status === 'pending')
    );
  }, []);

  const activeTransfers = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'pending'
  );

  return {
    transfers, activeTransfers,
    uploadFile, downloadFile, cancelTransfer, clearCompleted,
  };
}
