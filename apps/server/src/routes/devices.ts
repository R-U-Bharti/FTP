import { Router, type Request, type Response } from 'express';
import { getLocalIPAddress, getHostname, getDeviceInfo, getAllLocalIPs } from '../utils/network.js';
import type { DiscoveryService } from '../services/discovery.js';
import type { SessionManager } from '../services/sessionManager.js';
import QRCode from 'qrcode';

/**
 * Device info and discovery REST API routes.
 */
export function createDeviceRoutes(
  discovery: DiscoveryService,
  sessionManager: SessionManager,
  serverPort: number
): Router {
  const router = Router();

  // ── Get this device's info ──
  router.get('/info', (_req: Request, res: Response) => {
    const { platform, deviceType } = getDeviceInfo();
    res.json({
      id: discovery.getDeviceId(),
      name: getHostname(),
      ip: getLocalIPAddress(),
      port: serverPort,
      platform,
      deviceType,
      allIPs: getAllLocalIPs(),
    });
  });

  // ── List discovered devices ──
  router.get('/list', (_req: Request, res: Response) => {
    res.json(discovery.getDevices());
  });

  // ── Generate QR code for pairing ──
  router.get('/pair/qr', async (_req: Request, res: Response) => {
    try {
      const ip = getLocalIPAddress();
      const code = sessionManager.createPairingCode(discovery.getDeviceId(), ip, serverPort);
      const qrData = JSON.stringify({ code, ip, port: serverPort, deviceId: discovery.getDeviceId() });
      const qrImage = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });
      res.json({ code, qrImage, expiresIn: 300 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pair via code ──
  router.post('/pair', (req: Request, res: Response) => {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: 'Pairing code required' });
      return;
    }
    const result = sessionManager.consumePairingCode(code);
    if (result) {
      const token = sessionManager.createSession(result.deviceId, 'Paired Device');
      res.json({ success: true, token, ...result });
    } else {
      res.status(400).json({ success: false, error: 'Invalid or expired pairing code' });
    }
  });

  return router;
}
