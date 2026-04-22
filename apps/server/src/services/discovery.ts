import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import type { Device, DeviceHeartbeat } from '@localdrop/shared-types';
import { getLocalIPAddress, getBroadcastAddress, getHostname, getDeviceInfo } from '../utils/network.js';
import { generateDeviceId } from '../utils/crypto.js';

const DISCOVERY_PORT = 41234;
const HEARTBEAT_INTERVAL = 3000; // 3 seconds
const DEVICE_TIMEOUT = 10000; // 10 seconds without heartbeat = offline
const PROTOCOL_MAGIC = 'LOCALDROP_V1';

/**
 * UDP Broadcast-based device discovery service.
 * 
 * Each server instance broadcasts its info every 3 seconds on port 41234.
 * Other instances on the same subnet receive these broadcasts and maintain
 * a registry of discovered devices.
 */
export class DiscoveryService extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private devices: Map<string, Device> = new Map();
  private deviceId: string;
  private serverPort: number;

  constructor(serverPort: number, existingDeviceId?: string) {
    super();
    this.serverPort = serverPort;
    this.deviceId = existingDeviceId || generateDeviceId();
  }

  /** Get this device's ID */
  getDeviceId(): string {
    return this.deviceId;
  }

  /** Get all discovered devices (excluding self) */
  getDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  /** Start the discovery service */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.error('[Discovery] Socket error:', err.message);
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.bind(DISCOVERY_PORT, () => {
        this.socket!.setBroadcast(true);
        console.log(`[Discovery] Listening on port ${DISCOVERY_PORT}`);

        // Start broadcasting heartbeats
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL);
        this.sendHeartbeat(); // Send immediately

        // Start cleanup timer for stale devices
        this.cleanupTimer = setInterval(() => this.cleanupStaleDevices(), HEARTBEAT_INTERVAL);

        resolve();
      });
    });
  }

  /** Stop the discovery service */
  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.devices.clear();
  }

  /** Broadcast this device's info to the network */
  private sendHeartbeat(): void {
    if (!this.socket) return;

    const localIP = getLocalIPAddress();
    const { platform, deviceType } = getDeviceInfo();

    const heartbeat: DeviceHeartbeat = {
      id: this.deviceId,
      name: getHostname(),
      ip: localIP,
      port: this.serverPort,
      platform,
      deviceType,
      version: '1.0.0',
    };

    const message = Buffer.from(
      JSON.stringify({ magic: PROTOCOL_MAGIC, ...heartbeat })
    );

    const broadcastAddr = getBroadcastAddress(localIP);

    this.socket.send(message, 0, message.length, DISCOVERY_PORT, broadcastAddr, (err) => {
      if (err) {
        console.error('[Discovery] Broadcast error:', err.message);
      }
    });
  }

  /** Handle incoming discovery messages */
  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const data = JSON.parse(msg.toString());

      // Validate protocol magic
      if (data.magic !== PROTOCOL_MAGIC) return;

      // Ignore our own broadcasts
      if (data.id === this.deviceId) return;

      const device: Device = {
        id: data.id,
        name: data.name,
        ip: rinfo.address, // Use actual sender IP, not claimed IP
        port: data.port,
        platform: data.platform,
        deviceType: data.deviceType,
        online: true,
        lastSeen: Date.now(),
      };

      const isNew = !this.devices.has(device.id);
      const existing = this.devices.get(device.id);

      this.devices.set(device.id, device);

      if (isNew) {
        console.log(`[Discovery] New device: ${device.name} (${device.ip}:${device.port})`);
        this.emit('device:discovered', device);
      } else if (existing && !existing.online) {
        // Device came back online
        console.log(`[Discovery] Device back online: ${device.name}`);
        this.emit('device:discovered', device);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  /** Remove devices that haven't sent a heartbeat recently */
  private cleanupStaleDevices(): void {
    const now = Date.now();

    for (const [id, device] of this.devices) {
      if (now - device.lastSeen > DEVICE_TIMEOUT && device.online) {
        device.online = false;
        console.log(`[Discovery] Device offline: ${device.name}`);
        this.emit('device:lost', { deviceId: id });
      }

      // Remove completely if offline for more than 30 seconds
      if (now - device.lastSeen > 30000) {
        this.devices.delete(id);
      }
    }
  }
}
