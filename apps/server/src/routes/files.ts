import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import Busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';
import type { FileSystemService } from '../services/fileSystem.js';
import type { TransferManager } from '../services/transferManager.js';

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

/**
 * File system REST API routes.
 * Handles file listing, streaming downloads, and chunked uploads.
 */
export function createFileRoutes(
  fsService: FileSystemService,
  transferManager: TransferManager
): Router {
  const router = Router();

  // ── List directory contents ──
  router.get('/list', async (req: Request, res: Response) => {
    try {
      const dirPath = (req.query['path'] as string) || '.';
      const result = await fsService.listDirectory(dirPath);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Stream download a file ──
  router.get('/download', (req: Request, res: Response) => {
    try {
      const filePath = req.query['path'] as string;
      if (!filePath) {
        res.status(400).json({ error: 'Path parameter required' });
        return;
      }

      const { stream, size, mimeType } = fsService.createReadStream(filePath);
      const fileName = path.basename(filePath);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', size);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('X-File-Size', size.toString());

      // Track download progress
      const transferId = uuidv4();
      transferManager.createTransfer(
        transferId, fileName, size, 'download',
        'browser', 'Browser Client'
      );
      transferManager.updateStatus(transferId, 'transferring');

      let bytesStreamed = 0;
      stream.on('data', (chunk: Buffer) => {
        bytesStreamed += chunk.length;
        transferManager.updateProgress(transferId, bytesStreamed);
      });

      stream.on('end', () => {
        transferManager.completeTransfer(transferId);
      });

      stream.on('error', (err) => {
        transferManager.failTransfer(transferId, err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });

      stream.pipe(res);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Single file upload (streaming via busboy) ──
  router.post('/upload', (req: Request, res: Response) => {
    try {
      const targetDir = (req.query['path'] as string) || '.';
      const busboy = Busboy({ headers: req.headers });
      const results: Array<{ name: string; size: number }> = [];

      busboy.on('file', (_fieldname, fileStream, info) => {
        const { filename } = info;
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uploadPath = path.join(targetDir, safeName);
        const writeStream = fsService.createWriteStream(uploadPath);

        const transferId = uuidv4();
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        transferManager.createTransfer(
          transferId, safeName, contentLength, 'upload',
          'browser', 'Browser Client'
        );
        transferManager.updateStatus(transferId, 'transferring');

        let bytesWritten = 0;
        fileStream.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length;
          transferManager.updateProgress(transferId, bytesWritten);
        });

        fileStream.pipe(writeStream);

        writeStream.on('finish', () => {
          transferManager.completeTransfer(transferId);
          results.push({ name: safeName, size: bytesWritten });
        });

        writeStream.on('error', (err) => {
          transferManager.failTransfer(transferId, err.message);
        });
      });

      busboy.on('finish', () => {
        res.json({ success: true, files: results });
      });

      busboy.on('error', (err: Error) => {
        res.status(500).json({ error: err.message });
      });

      req.pipe(busboy);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Chunked upload (for large files with resume support) ──
  router.post('/upload/chunk', (req: Request, res: Response) => {
    try {
      const transferId = req.headers['x-transfer-id'] as string;
      const chunkIndex = parseInt(req.headers['x-chunk-index'] as string, 10);
      const totalChunks = parseInt(req.headers['x-total-chunks'] as string, 10);
      const fileName = req.headers['x-file-name'] as string;
      const fileSize = parseInt(req.headers['x-file-size'] as string, 10);

      if (!transferId || isNaN(chunkIndex) || isNaN(totalChunks) || !fileName) {
        res.status(400).json({ error: 'Missing required chunk headers' });
        return;
      }

      // Create transfer record on first chunk
      let transfer = transferManager.getTransfer(transferId);
      if (!transfer) {
        transfer = transferManager.createTransfer(
          transferId, fileName, fileSize, 'upload',
          'browser', 'Browser Client', totalChunks
        );
        transferManager.updateStatus(transferId, 'transferring');
      }

      // Write chunk to temp directory
      const chunkDir = transferManager.getTransferTempDir(transferId);
      const chunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);
      const writeStream = fs.createWriteStream(chunkPath);

      req.pipe(writeStream);

      writeStream.on('finish', async () => {
        const chunkSize = fs.statSync(chunkPath).size;
        transferManager.recordChunk(transferId, chunkIndex, chunkSize);

        // Check if all chunks received
        if (transferManager.isComplete(transferId)) {
          try {
            const outputPath = fsService.resolvePath(fileName);
            await transferManager.reassembleChunks(transferId, outputPath, totalChunks);
            transferManager.completeTransfer(transferId);
            res.json({ success: true, complete: true, fileName });
          } catch (err: any) {
            transferManager.failTransfer(transferId, err.message);
            res.status(500).json({ error: err.message });
          }
        } else {
          const missing = transferManager.getMissingChunks(transferId);
          res.json({ success: true, complete: false, missingChunks: missing });
        }
      });

      writeStream.on('error', (err) => {
        transferManager.failTransfer(transferId, err.message);
        res.status(500).json({ error: err.message });
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Get file preview (for images/videos) ──
  router.get('/preview', (req: Request, res: Response) => {
    try {
      const filePath = req.query['path'] as string;
      if (!filePath) {
        res.status(400).json({ error: 'Path parameter required' });
        return;
      }
      const { stream, mimeType } = fsService.createReadStream(filePath);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      stream.pipe(res);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Get file info ──
  router.get('/info', (req: Request, res: Response) => {
    try {
      const filePath = req.query['path'] as string;
      if (!filePath) {
        res.status(400).json({ error: 'Path parameter required' });
        return;
      }
      const info = fsService.getFileInfo(filePath);
      res.json(info);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
