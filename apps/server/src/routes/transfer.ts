import { Router, type Request, type Response } from 'express';
import type { TransferManager } from '../services/transferManager.js';

/**
 * Transfer status REST API routes.
 */
export function createTransferRoutes(transferManager: TransferManager): Router {
  const router = Router();

  // ── Get all transfers ──
  router.get('/list', (_req: Request, res: Response) => {
    res.json(transferManager.getAllTransfers());
  });

  // ── Get active transfers ──
  router.get('/active', (_req: Request, res: Response) => {
    res.json(transferManager.getActiveTransfers());
  });

  // ── Get specific transfer ──
  router.get('/:id', (req: Request, res: Response) => {
    const transfer = transferManager.getTransfer(req.params['id']!);
    if (!transfer) {
      res.status(404).json({ error: 'Transfer not found' });
      return;
    }
    res.json(transfer);
  });

  // ── Get missing chunks for resume ──
  router.get('/:id/missing-chunks', (req: Request, res: Response) => {
    const missing = transferManager.getMissingChunks(req.params['id']!);
    res.json({ missingChunks: missing });
  });

  return router;
}
