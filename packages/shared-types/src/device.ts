/** Represents a discovered device on the local network */
export interface Device {
  /** Unique device identifier (generated on first launch) */
  id: string;
  /** Human-readable device name (defaults to OS hostname) */
  name: string;
  /** Local network IP address */
  ip: string;
  /** Express server port */
  port: number;
  /** Operating system platform */
  platform: 'win32' | 'darwin' | 'linux' | 'android' | 'ios' | string;
  /** Device type for icon display */
  deviceType: 'desktop' | 'laptop' | 'mobile' | 'tablet' | 'unknown';
  /** Whether the device is currently online */
  online: boolean;
  /** Timestamp of last heartbeat */
  lastSeen: number;
  /** Session token for authenticated communication */
  sessionToken?: string;
}

/** Device registration payload sent via UDP broadcast */
export interface DeviceHeartbeat {
  id: string;
  name: string;
  ip: string;
  port: number;
  platform: string;
  deviceType: string;
  version: string;
}
