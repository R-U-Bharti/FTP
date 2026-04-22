/** Represents a file or directory entry from the file system */
export interface FileEntry {
  /** File or directory name */
  name: string;
  /** Full path on the remote device */
  path: string;
  /** File size in bytes (0 for directories) */
  size: number;
  /** Whether this entry is a directory */
  isDirectory: boolean;
  /** MIME type (for files only) */
  mimeType?: string;
  /** Last modified timestamp (ISO string) */
  modifiedAt: string;
  /** File extension without dot */
  extension?: string;
  /** Number of children (for directories) */
  childCount?: number;
}

/** Response from the file listing API */
export interface FileListResponse {
  /** Current directory path */
  currentPath: string;
  /** Parent directory path (null if at root) */
  parentPath: string | null;
  /** List of file/directory entries */
  entries: FileEntry[];
  /** Total number of entries */
  totalEntries: number;
}

/** Supported file preview types */
export type PreviewType = 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'none';
