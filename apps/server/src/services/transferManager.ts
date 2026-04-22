import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Transfer, TransferStatus } from '@localdrop/shared-types';

/**
 * Manages all active file transfers with progress tracking and chunk reassembly.
 */
export class TransferManager extends EventEmitter {
  private transfers: Map<string, Transfer> = new Map();
  private chunkTracking: Map<string, Set<number>> = new Map();
  private tempDir: string;

  constructor(tempDir: string) {
    super();
    this.tempDir = tempDir;
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  createTransfer(
    id: string, fileName: string, fileSize: number,
    direction: 'upload' | 'download',
    remoteDeviceId: string, remoteDeviceName: string,
    totalChunks?: number
  ): Transfer {
    const transfer: Transfer = {
      id, fileName, fileSize, bytesTransferred: 0, progress: 0,
      speed: 0, eta: 0, status: 'pending', direction, method: 'http',
      remoteDeviceId, remoteDeviceName, startedAt: Date.now(),
      totalChunks, receivedChunks: 0,
    };
    this.transfers.set(id, transfer);
    if (totalChunks) this.chunkTracking.set(id, new Set());
    return transfer;
  }

  updateProgress(id: string, bytesTransferred: number): void {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    transfer.bytesTransferred = bytesTransferred;
    transfer.progress = transfer.fileSize > 0
      ? Math.min(100, (bytesTransferred / transfer.fileSize) * 100) : 0;
    const elapsed = (Date.now() - transfer.startedAt) / 1000;
    if (elapsed > 0) {
      transfer.speed = bytesTransferred / elapsed;
      transfer.eta = transfer.speed > 0 ? (transfer.fileSize - bytesTransferred) / transfer.speed : 0;
    }
    transfer.status = 'transferring';
    this.emit('progress', { ...transfer });
  }

  recordChunk(id: string, chunkIndex: number, chunkSize: number): void {
    const transfer = this.transfers.get(id);
    const chunks = this.chunkTracking.get(id);
    if (!transfer || !chunks) return;
    chunks.add(chunkIndex);
    transfer.receivedChunks = chunks.size;
    transfer.bytesTransferred = chunks.size * chunkSize;
    transfer.progress = transfer.totalChunks ? (chunks.size / transfer.totalChunks) * 100 : 0;
    const elapsed = (Date.now() - transfer.startedAt) / 1000;
    if (elapsed > 0) {
      transfer.speed = transfer.bytesTransferred / elapsed;
      transfer.eta = transfer.speed > 0 ? (transfer.fileSize - transfer.bytesTransferred) / transfer.speed : 0;
    }
    transfer.status = 'transferring';
    this.emit('progress', { ...transfer });
  }

  getMissingChunks(id: string): number[] {
    const transfer = this.transfers.get(id);
    const chunks = this.chunkTracking.get(id);
    if (!transfer || !chunks || !transfer.totalChunks) return [];
    const missing: number[] = [];
    for (let i = 0; i < transfer.totalChunks; i++) {
      if (!chunks.has(i)) missing.push(i);
    }
    return missing;
  }

  isComplete(id: string): boolean {
    const transfer = this.transfers.get(id);
    const chunks = this.chunkTracking.get(id);
    if (!transfer || !chunks || !transfer.totalChunks) return false;
    return chunks.size >= transfer.totalChunks;
  }

  completeTransfer(id: string): void {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    transfer.status = 'completed';
    transfer.progress = 100;
    transfer.bytesTransferred = transfer.fileSize;
    transfer.completedAt = Date.now();
    transfer.eta = 0;
    this.emit('complete', { ...transfer });
    this.chunkTracking.delete(id);
  }

  failTransfer(id: string, error: string): void {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    transfer.status = 'failed';
    transfer.error = error;
    this.emit('error', { ...transfer });
  }

  updateStatus(id: string, status: TransferStatus): void {
    const transfer = this.transfers.get(id);
    if (!transfer) return;
    transfer.status = status;
  }

  getTransfer(id: string): Transfer | undefined { return this.transfers.get(id); }
  getAllTransfers(): Transfer[] { return Array.from(this.transfers.values()); }
  getActiveTransfers(): Transfer[] {
    return this.getAllTransfers().filter(
      (t) => t.status === 'transferring' || t.status === 'pending' || t.status === 'approved'
    );
  }

  getTransferTempDir(transferId: string): string {
    const dir = path.join(this.tempDir, transferId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async reassembleChunks(transferId: string, outputPath: string, totalChunks: number): Promise<void> {
    const chunkDir = this.getTransferTempDir(transferId);
    const writeStream = fs.createWriteStream(outputPath);
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunkDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        writeStream.destroy();
        throw new Error(`Missing chunk ${i}`);
      }
      await new Promise<void>((resolve, reject) => {
        const rs = fs.createReadStream(chunkPath);
        rs.on('error', reject);
        rs.on('end', resolve);
        rs.pipe(writeStream, { end: false });
      });
    }
    writeStream.end();
    await this.cleanupTransferTemp(transferId);
  }

  async cleanupTransferTemp(transferId: string): Promise<void> {
    const dir = path.join(this.tempDir, transferId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}
