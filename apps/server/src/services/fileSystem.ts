import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import mimeTypes from 'mime-types';
import type { FileEntry, FileListResponse } from '@localdrop/shared-types';

/** Default shared directory: ~/LocalDrop */
const DEFAULT_SHARED_DIR = path.join(os.homedir(), 'LocalDrop');

/**
 * Sandboxed file system service.
 * All operations are restricted to the configured root directory
 * to prevent unauthorized access to the rest of the file system.
 */
export class FileSystemService {
  private rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir || DEFAULT_SHARED_DIR;
    this.ensureRootDir();
  }

  /** Get the root directory path */
  getRootDir(): string {
    return this.rootDir;
  }

  /** Ensure root directory exists */
  private ensureRootDir(): void {
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
      console.log(`[FileSystem] Created shared directory: ${this.rootDir}`);
    }
  }

  /**
   * Resolve and validate a path, ensuring it stays within the sandbox.
   * Prevents path traversal attacks (e.g., ../../etc/passwd).
   */
  resolvePath(requestedPath: string): string {
    // Normalize and resolve relative to root
    const resolved = path.resolve(this.rootDir, requestedPath);

    // Security: ensure the resolved path is still within root
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error('Access denied: path traversal detected');
    }

    return resolved;
  }

  /** List files and directories at a given path */
  async listDirectory(dirPath: string = '.'): Promise<FileListResponse> {
    const resolvedPath = this.resolvePath(dirPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    const entries: FileEntry[] = [];
    const dirEntries = fs.readdirSync(resolvedPath, { withFileTypes: true });

    for (const entry of dirEntries) {
      // Skip hidden files and system files
      if (entry.name.startsWith('.')) continue;

      try {
        const fullPath = path.join(resolvedPath, entry.name);
        const entryStats = fs.statSync(fullPath);
        const relativePath = path.relative(this.rootDir, fullPath);

        const fileEntry: FileEntry = {
          name: entry.name,
          path: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
          size: entryStats.isDirectory() ? 0 : entryStats.size,
          isDirectory: entryStats.isDirectory(),
          modifiedAt: entryStats.mtime.toISOString(),
          extension: entryStats.isDirectory()
            ? undefined
            : path.extname(entry.name).slice(1).toLowerCase(),
          mimeType: entryStats.isDirectory()
            ? undefined
            : mimeTypes.lookup(entry.name) || 'application/octet-stream',
        };

        // Get child count for directories
        if (entryStats.isDirectory()) {
          try {
            fileEntry.childCount = fs.readdirSync(fullPath).filter(
              (n) => !n.startsWith('.')
            ).length;
          } catch {
            fileEntry.childCount = 0;
          }
        }

        entries.push(fileEntry);
      } catch {
        // Skip files we can't access
        continue;
      }
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Calculate parent path
    const currentRelative = path.relative(this.rootDir, resolvedPath).replace(/\\/g, '/');
    const parentPath = currentRelative
      ? path.dirname(currentRelative).replace(/\\/g, '/')
      : null;

    return {
      currentPath: currentRelative || '.',
      parentPath: parentPath === '.' && !currentRelative ? null : parentPath,
      entries,
      totalEntries: entries.length,
    };
  }

  /** Create a read stream for a file (for streaming downloads) */
  createReadStream(filePath: string): { stream: fs.ReadStream; size: number; mimeType: string } {
    const resolvedPath = this.resolvePath(filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      throw new Error(`Cannot download a directory: ${filePath}`);
    }

    return {
      stream: fs.createReadStream(resolvedPath),
      size: stats.size,
      mimeType: (mimeTypes.lookup(resolvedPath) as string) || 'application/octet-stream',
    };
  }

  /** Create a write stream for a file (for streaming uploads) */
  createWriteStream(filePath: string): fs.WriteStream {
    const resolvedPath = this.resolvePath(filePath);

    // Ensure parent directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return fs.createWriteStream(resolvedPath);
  }

  /** Get file info */
  getFileInfo(filePath: string): FileEntry {
    const resolvedPath = this.resolvePath(filePath);
    const stats = fs.statSync(resolvedPath);
    const relativePath = path.relative(this.rootDir, resolvedPath).replace(/\\/g, '/');

    return {
      name: path.basename(resolvedPath),
      path: relativePath,
      size: stats.size,
      isDirectory: stats.isDirectory(),
      modifiedAt: stats.mtime.toISOString(),
      extension: stats.isDirectory() ? undefined : path.extname(resolvedPath).slice(1).toLowerCase(),
      mimeType: stats.isDirectory()
        ? undefined
        : (mimeTypes.lookup(resolvedPath) as string) || 'application/octet-stream',
    };
  }

  /** Check if a path exists */
  exists(filePath: string): boolean {
    try {
      const resolvedPath = this.resolvePath(filePath);
      return fs.existsSync(resolvedPath);
    } catch {
      return false;
    }
  }

  /** Get the full temp directory path for chunked uploads */
  getTempDir(): string {
    const tempDir = path.join(this.rootDir, '.localdrop-temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
  }
}
