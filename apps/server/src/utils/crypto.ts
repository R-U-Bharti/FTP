import { randomUUID, randomBytes } from 'node:crypto';

/** Generate a unique device ID (persisted across sessions) */
export function generateDeviceId(): string {
  return randomUUID();
}

/** Generate a session token for authenticated communication */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** Generate a short pairing code (6 alphanumeric characters) */
export function generatePairingCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
}
