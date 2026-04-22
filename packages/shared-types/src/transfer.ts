/** Status of a file transfer */
export type TransferStatus =
  | 'pending'      // Waiting for approval
  | 'approved'     // Approved, waiting to start
  | 'transferring' // Currently transferring
  | 'paused'       // Paused by user
  | 'completed'    // Successfully completed
  | 'failed'       // Failed with error
  | 'cancelled';   // Cancelled by user

/** Direction of the transfer relative to this device */
export type TransferDirection = 'upload' | 'download';

/** Transfer method being used */
export type TransferMethod = 'http' | 'webrtc';

/** Represents an active or completed file transfer */
export interface Transfer {
  /** Unique transfer identifier */
  id: string;
  /** Name of the file being transferred */
  fileName: string;
  /** Total file size in bytes */
  fileSize: number;
  /** Bytes transferred so far */
  bytesTransferred: number;
  /** Transfer progress (0-100) */
  progress: number;
  /** Current transfer speed in bytes/sec */
  speed: number;
  /** Estimated time remaining in seconds */
  eta: number;
  /** Transfer status */
  status: TransferStatus;
  /** Upload or download */
  direction: TransferDirection;
  /** HTTP streaming or WebRTC P2P */
  method: TransferMethod;
  /** ID of the remote device */
  remoteDeviceId: string;
  /** Name of the remote device */
  remoteDeviceName: string;
  /** Timestamp when transfer started */
  startedAt: number;
  /** Timestamp when transfer completed */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
  /** For chunked uploads: total chunks */
  totalChunks?: number;
  /** For chunked uploads: received chunks */
  receivedChunks?: number;
}

/** Request to send files to another device */
export interface TransferRequest {
  /** Target device ID */
  targetDeviceId: string;
  /** Files to transfer */
  files: Array<{
    name: string;
    size: number;
    type: string;
    relativePath?: string;
  }>;
}

/** Chunk metadata for resumable uploads */
export interface ChunkMetadata {
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  fileName: string;
  fileSize: number;
  chunkSize: number;
}
