const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

interface ChunkedUploadOptions {
  file: File;
  transferId: string;
  targetUrl: string;
  targetPath?: string;
  onProgress?: (progress: number, speed: number, eta: number) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
}

/**
 * Upload a file in chunks for resume support and memory efficiency.
 * Each chunk is sent as a separate HTTP request with metadata headers.
 * If interrupted, only missing chunks need to be re-sent.
 */
export async function chunkedUpload(options: ChunkedUploadOptions): Promise<void> {
  const { file, transferId, targetUrl, onProgress, onComplete, onError, signal } = options;

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const startTime = Date.now();
  let uploadedBytes = 0;

  // Check for any previously uploaded chunks (resume support)
  let missingChunks: number[] = [];
  try {
    const res = await fetch(`/api/transfers/${transferId}/missing-chunks`);
    const data = await res.json();
    missingChunks = data.missingChunks;
  } catch {
    // First upload — all chunks needed
    missingChunks = Array.from({ length: totalChunks }, (_, i) => i);
  }

  // If no chunks are missing, check if all should be uploaded
  if (missingChunks.length === 0) {
    missingChunks = Array.from({ length: totalChunks }, (_, i) => i);
  }

  for (const chunkIndex of missingChunks) {
    if (signal?.aborted) {
      onError?.('Upload cancelled');
      return;
    }

    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    try {
      const response = await fetch(`${targetUrl}/api/files/upload/chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Transfer-Id': transferId,
          'X-Chunk-Index': chunkIndex.toString(),
          'X-Total-Chunks': totalChunks.toString(),
          'X-File-Name': file.name,
          'X-File-Size': file.size.toString(),
        },
        body: chunk,
        signal,
      });

      if (!response.ok) {
        throw new Error(`Chunk ${chunkIndex} failed: ${response.statusText}`);
      }

      uploadedBytes += end - start;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
      const remaining = file.size - uploadedBytes;
      const eta = speed > 0 ? remaining / speed : 0;
      const progress = (uploadedBytes / file.size) * 100;

      onProgress?.(progress, speed, eta);

      const result = await response.json();
      if (result.complete) {
        onComplete?.();
        return;
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        onError?.('Upload cancelled');
        return;
      }
      onError?.(err.message);
      return;
    }
  }

  onComplete?.();
}

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Format seconds to human-readable time */
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
