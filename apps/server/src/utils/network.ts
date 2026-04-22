import os from 'node:os';

/** Network interface info */
export interface NetworkInfo {
  ip: string;
  family: string;
  interface: string;
  mac: string;
}

/**
 * Get the best local IPv4 address for LAN communication.
 * Filters out loopback, virtual (VMware/VirtualBox/Docker) and VPN interfaces.
 */
export function getLocalIPAddress(): string {
  const interfaces = os.networkInterfaces();
  const candidates: NetworkInfo[] = [];

  // Patterns for virtual/VPN interfaces to exclude
  const excludePatterns = [
    /^veth/i, /^docker/i, /^br-/i, /^vmnet/i, /^vbox/i,
    /^virbr/i, /^tun/i, /^tap/i, /^wsl/i, /^ham/i,
  ];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    // Skip excluded interfaces
    if (excludePatterns.some((p) => p.test(name))) continue;

    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push({
          ip: addr.address,
          family: addr.family,
          interface: name,
          mac: addr.mac,
        });
      }
    }
  }

  // Prefer WiFi/Ethernet interfaces
  const preferred = candidates.find(
    (c) => /^(wi-fi|wlan|eth|en)/i.test(c.interface)
  );

  return preferred?.ip || candidates[0]?.ip || '127.0.0.1';
}

/**
 * Get all valid local IPv4 addresses (for multi-homed setups like USB tethering).
 */
export function getAllLocalIPs(): NetworkInfo[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkInfo[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        results.push({
          ip: addr.address,
          family: addr.family,
          interface: name,
          mac: addr.mac,
        });
      }
    }
  }

  return results;
}

/** Get the device hostname */
export function getHostname(): string {
  return os.hostname();
}

/** Detect OS platform and device type */
export function getDeviceInfo(): { platform: string; deviceType: string } {
  const platform = os.platform();
  // On a server context, it's always desktop/laptop
  return {
    platform,
    deviceType: 'desktop',
  };
}

/** Get the broadcast address for a given IP (assumes /24 subnet) */
export function getBroadcastAddress(ip: string): string {
  const parts = ip.split('.');
  parts[3] = '255';
  return parts.join('.');
}
