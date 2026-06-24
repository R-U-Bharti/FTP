import express from 'express';
import { createServer } from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
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
import { setupWebServing } from './utils/serveWeb.js';

// ── Configuration ──
const DESIRED_PORT = parseInt(process.env['PORT'] || '3001', 10);
const SHARED_DIR = process.env['SHARED_DIR'] || undefined; // Defaults to ~/LocalDrop

/** Find a free TCP port, starting at `start` and scanning upward. */
function findFreePort(start: number, attempts = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;
    let remaining = attempts;
    const tryPort = () => {
      const tester = net
        .createServer()
        .once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' && remaining-- > 0) {
            port += 1;
            tryPort();
          } else {
            reject(err);
          }
        })
        .once('listening', () => {
          tester.close(() => resolve(port));
        })
        .listen(port, '0.0.0.0');
    };
    tryPort();
  });
}

/** Open the given URL in the user's default browser (best effort). */
function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* not fatal — user can open the URL manually */
  }
}

async function main(): Promise<void> {
  const PORT = await findFreePort(DESIRED_PORT);

  // ── Initialize services ──
  const fsService = new FileSystemService(SHARED_DIR);
  const transferManager = new TransferManager(fsService.getTempDir());
  const sessionManager = new SessionManager();
  const discovery = new DiscoveryService(PORT);

  // ── Express setup ──
  const app = express();
  const httpServer = createServer(app);

  // CORS — allow all local network origins
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );

  app.use(express.json());

  // ── API Routes ──
  app.use('/api/files', createFileRoutes(fsService, transferManager));
  app.use('/api/devices', createDeviceRoutes(discovery, sessionManager, PORT));
  app.use('/api/transfers', createTransferRoutes(transferManager));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', deviceId: discovery.getDeviceId() });
  });

  // ── Static web UI (served from the bundled build when packaged) ──
  const webServed = setupWebServing(app);

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
    console.log(`  ║  Local:    http://localhost:${PORT}`);

    allIPs.forEach(info => {
      console.log(`  ║  Network:  http://${info.ip}:${PORT} (${info.interface})`);
    });

    console.log(`  ║  Shared:   ${fsService.getRootDir()}`);
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');

    if (webServed) {
      const url = `http://localhost:${PORT}`;
      console.log(`  🌐 Web UI ready — opening ${url}`);
      openBrowser(url);
    } else {
      console.log('  ⚠️  Web UI build not found (running in API-only mode)');
    }

    // Start device discovery
    try {
      await discovery.start();
      console.log('  ✅ Device discovery active');
    } catch {
      console.error('  ⚠️  Device discovery failed (port 41234 may be in use)');
      console.error('     Devices can still connect via QR code or manual IP');
    }
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n  Shutting down (${signal})...`);
    discovery.stop();
    io.close();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('  ❌ Failed to start LocalDrop:', err);
  process.exit(1);
});
