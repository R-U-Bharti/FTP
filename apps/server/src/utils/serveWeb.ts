import fs from 'node:fs';
import path from 'node:path';
import mimeTypes from 'mime-types';
import type { Express, Request, Response, NextFunction } from 'express';
import { webAssets } from '../generated/webAssets.js';

// In the packaged CJS bundle `__dirname` is the snapshot dir; in ESM dev it is undefined.
declare const __dirname: string;

/** Decode the embedded base64 web build into memory once at startup. */
const embedded = new Map<string, Buffer>();
for (const [key, b64] of Object.entries(webAssets)) {
  embedded.set(key, Buffer.from(b64, 'base64'));
}

function setHeaders(res: Response, urlPath: string): void {
  const type = mimeTypes.lookup(urlPath) || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  if (/\.(js|mjs|css|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(urlPath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

const isAppRoute = (p: string) => p.startsWith('/api') || p.startsWith('/socket.io');

/** Serve the UI from the in-memory embedded build (used in the packaged exe). */
function serveEmbedded(app: Express): boolean {
  const index = embedded.get('/index.html');
  if (!index) return false;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isAppRoute(req.path)) {
      return next();
    }
    const key = req.path === '/' ? '/index.html' : decodeURIComponent(req.path);
    const hit = embedded.get(key);
    if (hit) {
      setHeaders(res, key);
      return res.send(hit);
    }
    // SPA fallback
    setHeaders(res, '/index.html');
    return res.send(index);
  });
  return true;
}

/** Locate apps/web/dist on disk (dev / unpackaged fallback). */
function resolveWebDir(): string | null {
  const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    path.join(baseDir, '..', '..', 'web', 'dist'),
    path.join(process.cwd(), '..', 'web', 'dist'),
    path.join(process.cwd(), 'public'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Serve the UI straight from disk (dev / unpackaged fallback). */
function serveFromDisk(app: Express, webDir: string): boolean {
  const indexHtml = path.join(webDir, 'index.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isAppRoute(req.path)) {
      return next();
    }
    const rel = path
      .normalize(decodeURIComponent(req.path))
      .replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(webDir, rel);
    let target = indexHtml; // SPA fallback by default
    if (filePath.startsWith(webDir)) {
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) target = filePath;
      } catch {
        /* use fallback */
      }
    }
    try {
      setHeaders(res, target);
      return res.send(fs.readFileSync(target));
    } catch {
      return next();
    }
  });
  return true;
}

/**
 * Serve the static web UI for any non-API GET request, with SPA fallback.
 * Prefers the embedded build (packaged exe); falls back to disk in dev.
 * Returns true if a web build was found and mounted.
 */
export function setupWebServing(app: Express): boolean {
  if (serveEmbedded(app)) return true;
  const webDir = resolveWebDir();
  return webDir ? serveFromDisk(app, webDir) : false;
}
