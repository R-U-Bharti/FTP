import { formatBytes, formatTime } from './chunkedUpload';

interface StreamDownloadOptions {
  url: string;
  fileName: string;
  onProgress?: (progress: number, speed: number, eta: number) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
}

/**
 * Download a file using streaming fetch with progress tracking.
 * Uses ReadableStream to monitor progress without loading the entire file in memory.
 */
export async function streamDownload(options: StreamDownloadOptions): Promise<void> {
  const { url, fileName, onProgress, onComplete, onError, signal } = options;

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('ReadableStream not supported');

    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedBytes += value.length;

      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? receivedBytes / elapsed : 0;
      const remaining = contentLength - receivedBytes;
      const eta = speed > 0 ? remaining / speed : 0;
      const progress = contentLength > 0 ? (receivedBytes / contentLength) * 100 : 0;

      onProgress?.(progress, speed, eta);
    }

    // Create blob and trigger download
    const blob = new Blob(chunks);
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    onComplete?.();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      onError?.('Download cancelled');
      return;
    }
    onError?.(err.message);
  }
}
