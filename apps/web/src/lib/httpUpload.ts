/**
 * Direct HTTP upload to a device's native server (PC → phone).
 *
 * The browser streams the raw File to the phone's Kotlin HTTP server, which writes
 * it straight to disk. For large files on a `file://` target, the upload is split
 * across several parallel connections (each writing a disjoint byte range via
 * X-Offset), which fills a Wi‑Fi 6 link far better than a single TCP stream.
 * SAF (`content://`) targets and small files use a single stream.
 */

export interface HttpUploadOptions {
  file: File;
  /** Full upload endpoint, e.g. `http://192.168.1.5:8080/upload`. */
  url: string;
  /** Destination folder on the device (an explorer path/URI, or "." for the shared root). */
  targetDir: string;
  onProgress?: (progress: number, speed: number, eta: number) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
  signal?: AbortSignal;
}

const CONNECTIONS = 6; // parallel streams for large uploads
const MIN_PARALLEL = 8 * 1024 * 1024; // only parallelize files larger than this

/** Upload a single file directly to a device's native HTTP server. */
export function httpUploadToDevice(options: HttpUploadOptions): void {
  const { file, targetDir } = options;
  // Positional/parallel writes require seekable storage — only `file://` paths qualify.
  const parallelEligible = targetDir.startsWith('file://') && file.size > MIN_PARALLEL;
  if (parallelEligible) parallelUpload(options);
  else singleUpload(options);
}

/** Single-stream upload (small files, or SAF/root targets). */
function singleUpload(options: HttpUploadOptions): void {
  const { file, url, targetDir, onProgress, onComplete, onError, signal } = options;
  if (signal?.aborted) {
    onError?.('Upload cancelled');
    return;
  }

  const xhr = new XMLHttpRequest();
  const startTime = Date.now();
  xhr.open('POST', url, true);
  xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
  xhr.setRequestHeader('X-Target-Dir', encodeURIComponent(targetDir));
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');

  const onAbort = () => xhr.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  const cleanup = () => signal?.removeEventListener('abort', onAbort);

  xhr.upload.onprogress = (e: ProgressEvent) => {
    if (!e.lengthComputable) return;
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? e.loaded / elapsed : 0;
    const eta = speed > 0 ? (e.total - e.loaded) / speed : 0;
    onProgress?.(e.total > 0 ? (e.loaded / e.total) * 100 : 0, speed, eta);
  };
  xhr.onload = () => {
    cleanup();
    if (xhr.status >= 200 && xhr.status < 300) onComplete?.();
    else onError?.(serverError(xhr, `Upload failed (HTTP ${xhr.status})`));
  };
  xhr.onerror = () => {
    cleanup();
    onError?.('Could not reach the phone (check same Wi‑Fi, and that the app is open)');
  };
  xhr.onabort = () => {
    cleanup();
    onError?.('Upload cancelled');
  };
  xhr.send(file);
}

/** Multi-connection upload: N parts, each posting a byte range with X-Offset. */
function parallelUpload(options: HttpUploadOptions): void {
  const { file, url, targetDir, onProgress, onComplete, onError, signal } = options;
  if (signal?.aborted) {
    onError?.('Upload cancelled');
    return;
  }

  const total = file.size;
  const partSize = Math.ceil(total / CONNECTIONS);
  const parts: Array<[number, number]> = [];
  for (let start = 0; start < total; start += partSize) {
    parts.push([start, Math.min(start + partSize, total)]);
  }

  const loaded = new Array(parts.length).fill(0);
  const startTime = Date.now();
  const xhrs: XMLHttpRequest[] = [];
  let finished = false;
  let completedParts = 0;

  const onAbort = () => xhrs.forEach((x) => x.abort());
  if (signal) signal.addEventListener('abort', onAbort);
  const cleanup = () => signal?.removeEventListener('abort', onAbort);

  const report = () => {
    const sum = loaded.reduce((a, b) => a + b, 0);
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? sum / elapsed : 0;
    const eta = speed > 0 ? (total - sum) / speed : 0;
    onProgress?.((sum / total) * 100, speed, eta);
  };

  const fail = (msg: string) => {
    if (finished) return;
    finished = true;
    cleanup();
    onAbort();
    onError?.(msg);
  };

  parts.forEach(([start, end], i) => {
    const xhr = new XMLHttpRequest();
    xhrs.push(xhr);
    xhr.open('POST', url, true);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-Target-Dir', encodeURIComponent(targetDir));
    xhr.setRequestHeader('X-Total-Size', String(total));
    xhr.setRequestHeader('X-Offset', String(start));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        loaded[i] = e.loaded;
        report();
      }
    };
    xhr.onload = () => {
      if (finished) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        loaded[i] = end - start;
        completedParts++;
        report();
        if (completedParts === parts.length) {
          finished = true;
          cleanup();
          onComplete?.();
        }
      } else {
        fail(serverError(xhr, `Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => fail('Could not reach the phone (check same Wi‑Fi, and that the app is open)');
    xhr.onabort = () => {
      if (!finished) {
        finished = true;
        cleanup();
        onError?.('Upload cancelled');
      }
    };
    xhr.send(file.slice(start, end));
  });
}

function serverError(xhr: XMLHttpRequest, fallback: string): string {
  try {
    const parsed = JSON.parse(xhr.responseText);
    if (parsed?.error) return parsed.error;
  } catch {
    /* non-JSON body */
  }
  return fallback;
}
