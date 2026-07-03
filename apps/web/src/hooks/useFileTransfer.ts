import { useState, useCallback, useEffect } from 'react';
import type { Transfer, Device } from '@localdrop/shared-types';
import { chunkedUpload } from '../lib/chunkedUpload';
import { httpUploadToDevice } from '../lib/httpUpload';
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

  /**
   * Upload a file to a target device.
   * - Expo mobile app  → direct HTTP stream to its native server (PC → phone, fast path).
   * - No device / other server → chunked upload to `baseUrl` (self, or another PC).
   *
   * @param targetPath Destination folder on the device (explorer path/URI, or "." for the shared root).
   */
  const uploadFile = useCallback(
    (file: File, device?: Device | null, targetPath: string = '.') => {
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
        remoteDeviceId: device?.id ?? 'self',
        remoteDeviceName: device?.name ?? 'This Device',
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [...prev, transfer]);

      const onProgress = (progress: number, speed: number, eta: number) => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress, speed, eta, bytesTransferred: (progress / 100) * file.size, status: 'transferring' as const }
              : t
          )
        );
      };
      const onComplete = () => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, status: 'completed' as const, progress: 100, bytesTransferred: file.size, completedAt: Date.now() }
              : t
          )
        );
      };
      const onError = (error: string) => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId ? { ...t, status: 'failed' as const, error } : t
          )
        );
      };

      if (device?.isExpoApp) {
        // Fast path: stream straight to the phone's native HTTP server.
        httpUploadToDevice({
          file,
          url: `http://${device.ip}:${device.port || 8080}/upload`,
          targetDir: targetPath,
          signal: abortController.signal,
          onProgress,
          onComplete,
          onError,
        });
      } else {
        chunkedUpload({
          file,
          transferId,
          targetUrl: baseUrl,
          targetPath,
          signal: abortController.signal,
          onProgress,
          onComplete,
          onError,
        });
      }

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
