/**
 * Multi-connection download from a device's native server (phone → PC).
 *
 * Probes the file with a Range request; if the server supports ranges (file://
 * targets), the file is large, and the browser supports the File System Access API,
 * the file is pulled over several parallel connections and streamed straight to disk
 * at the right offsets — no whole-file buffering in RAM. Otherwise the caller falls
 * back to a plain anchor download (small files, SAF content:// files, Firefox/Safari).
 *
 * File System Access API is Chromium-only (Chrome/Edge).
 */

export interface ParallelDownloadOptions {
  /** Native download URL, e.g. `http://192.168.1.5:8080/download?uri=...`. */
  url: string;
  fileName: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

const CONNECTIONS = 6; // parallel streams
const MIN_PARALLEL = 8 * 1024 * 1024; // only parallelize files larger than this
const WRITE_BLOCK = 8 * 1024 * 1024; // batch small network chunks into big disk writes

/** Concatenate buffered chunks into one contiguous Uint8Array. */
function concatChunks(chunks: Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * @returns true if the download was handled here (streamed to disk, or user cancelled
 *   the save dialog); false if the caller should fall back to a normal anchor download.
 */
export async function parallelDownload(options: ParallelDownloadOptions): Promise<boolean> {
  const { url, fileName, onProgress, signal } = options;
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker !== 'function') return false;

  // ── Probe: range-capable? how big? (fast bytes=0-0 request; keeps user activation alive) ──
  let total = 0;
  try {
    const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
    if (probe.status === 206) {
      const cr = probe.headers.get('Content-Range'); // "bytes 0-0/12345"
      if (cr) total = parseInt(cr.split('/')[1] || '0', 10);
    }
    try { await probe.body?.cancel(); } catch { /* ignore */ }
  } catch {
    return false;
  }
  if (!total || total < MIN_PARALLEL) return false; // small / not range-capable → anchor

  // ── Ask where to save (needs the click's transient activation) ──
  let handle: any;
  try {
    handle = await picker.call(window, { suggestedName: fileName });
  } catch (e: any) {
    if (e?.name === 'AbortError') return true; // user cancelled — don't also anchor-download
    return false; // activation lost / unsupported → fall back to anchor
  }
  const writable = await handle.createWritable();

  // Serialize disk writes (positional) while keeping the network fetches parallel.
  let writeChain: Promise<void> = Promise.resolve();
  const writeAt = (position: number, data: Uint8Array): Promise<void> => {
    writeChain = writeChain.then(() => writable.write({ type: 'write', position, data }));
    return writeChain;
  };

  const partSize = Math.ceil(total / CONNECTIONS);
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < total; start += partSize) {
    ranges.push([start, Math.min(start + partSize, total) - 1]);
  }

  let loaded = 0;
  try {
    await Promise.all(
      ranges.map(async ([start, end]) => {
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
        if (!res.ok || !res.body) throw new Error(`Range ${start}-${end} failed (HTTP ${res.status})`);
        const reader = res.body.getReader();
        let writePos = start;
        let pending: Uint8Array[] = [];
        let pendingLen = 0;
        const flush = async () => {
          if (pendingLen === 0) return;
          const block = concatChunks(pending, pendingLen);
          const at = writePos;
          writePos += pendingLen;
          pending = [];
          pendingLen = 0;
          await writeAt(at, block);
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending.push(value);
          pendingLen += value.length;
          loaded += value.length;
          onProgress?.(loaded, total);
          if (pendingLen >= WRITE_BLOCK) await flush();
        }
        await flush();
      }),
    );
    await writeChain; // flush queued writes
    await writable.close();
    return true;
  } catch (err) {
    try { await writable.abort?.(); } catch { /* ignore — discards the partial file */ }
    throw err;
  }
}
