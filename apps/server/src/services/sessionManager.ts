import { generateSessionToken, generatePairingCode } from '../utils/crypto.js';

interface Session {
  token: string;
  deviceId: string;
  deviceName: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Session-based authentication manager.
 * Manages temporary sessions for paired devices.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private pairingCodes: Map<string, { deviceId: string; ip: string; port: number; createdAt: number }> = new Map();
  private sessionDuration = 24 * 60 * 60 * 1000; // 24 hours

  /** Create a new session for a paired device */
  createSession(deviceId: string, deviceName: string): string {
    const token = generateSessionToken();
    this.sessions.set(token, {
      token, deviceId, deviceName,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionDuration,
    });
    return token;
  }

  /** Validate a session token */
  validateSession(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  /** Generate a pairing code for QR/manual pairing */
  createPairingCode(deviceId: string, ip: string, port: number): string {
    const code = generatePairingCode();
    this.pairingCodes.set(code, { deviceId, ip, port, createdAt: Date.now() });
    // Auto-expire after 5 minutes
    setTimeout(() => this.pairingCodes.delete(code), 5 * 60 * 1000);
    return code;
  }

  /** Validate and consume a pairing code */
  consumePairingCode(code: string): { deviceId: string; ip: string; port: number } | null {
    const data = this.pairingCodes.get(code);
    if (!data) return null;
    if (Date.now() - data.createdAt > 5 * 60 * 1000) {
      this.pairingCodes.delete(code);
      return null;
    }
    this.pairingCodes.delete(code);
    return data;
  }

  /** Remove a session */
  revokeSession(token: string): void {
    this.sessions.delete(token);
  }

  /** Clean expired sessions */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) this.sessions.delete(token);
    }
  }
}
