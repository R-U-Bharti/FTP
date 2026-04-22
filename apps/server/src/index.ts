import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';

import { DiscoveryService } from './services/discovery.js';
import { FileSystemService } from './services/fileSystem.js';
import { TransferManager } from './services/transferManager.js';
import { SessionManager } from './services/sessionManager.js';
import { setupWebSocketHandlers } from './websocket/handler.js';
import { createFileRoutes } from './routes/files.js';
import { createDeviceRoutes } from './routes/devices.js';
import { createTransferRoutes } from './routes/transfer.js';
import { getAllLocalIPs } from './utils/network.js';

// ── Configuration ──
const PORT = parseInt(process.env['PORT'] || '3001', 10);
const SHARED_DIR = process.env['SHARED_DIR'] || undefined; // Defaults to ~/LocalDrop

// ── Initialize services ──
const fsService = new FileSystemService(SHARED_DIR);
const transferManager = new TransferManager(fsService.getTempDir());
const sessionManager = new SessionManager();
const discovery = new DiscoveryService(PORT);

// ── Express setup ──
const app = express();
const httpServer = createServer(app);

// CORS — allow all local network origins
app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json());

// ── API Routes ──
app.use('/api/files', createFileRoutes(fsService, transferManager));
app.use('/api/devices', createDeviceRoutes(discovery, sessionManager, PORT));
app.use('/api/transfers', createTransferRoutes(transferManager));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', deviceId: discovery.getDeviceId() });
});

// ── Socket.IO setup ──
const io = new SocketIOServer(httpServer, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 1e8, // 100MB max for Socket.IO messages
  pingTimeout: 60000,
  pingInterval: 25000,
});

setupWebSocketHandlers(io, discovery, transferManager, sessionManager);

// ── Start server ──
httpServer.listen(PORT, '0.0.0.0', async () => {
  const allIPs = getAllLocalIPs();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║           🚀 LocalDrop Server                ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  Local:    http://localhost:${PORT}             ║`);
  
  allIPs.forEach(info => {
    console.log(`  ║  Network:  http://${info.ip}:${PORT} (${info.interface})`);
  });
  
  console.log(`  ║  Shared:   ${fsService.getRootDir()}`);
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // Start device discovery
  try {
    await discovery.start();
    console.log('  ✅ Device discovery active');
  } catch (err) {
    console.error('  ⚠️  Device discovery failed (port 41234 may be in use)');
    console.error('     Devices can still connect via QR code or manual IP');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  discovery.stop();
  io.close();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  discovery.stop();
  io.close();
  httpServer.close();
  process.exit(0);
});
