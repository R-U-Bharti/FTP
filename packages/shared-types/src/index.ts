export * from './device';
export * from './file';
export * from './transfer';

// ─── Socket.IO Event Names ───────────────────────────────────────────────────

/** All WebSocket event names used between client and server */
export const WS_EVENTS = {
  // Device events
  DEVICE_DISCOVERED: 'device:discovered',
  DEVICE_LOST: 'device:lost',
  DEVICE_LIST: 'device:list',
  DEVICE_INFO: 'device:info',

  // Transfer events
  TRANSFER_REQUEST: 'transfer:request',
  TRANSFER_APPROVE: 'transfer:approve',
  TRANSFER_START: 'transfer:start',
  TRANSFER_PROGRESS: 'transfer:progress',
  TRANSFER_COMPLETE: 'transfer:complete',
  TRANSFER_ERROR: 'transfer:error',
  TRANSFER_CANCEL: 'transfer:cancel',

  // WebRTC signaling events
  RTC_OFFER: 'rtc:offer',
  RTC_ANSWER: 'rtc:answer',
  RTC_ICE_CANDIDATE: 'rtc:ice-candidate',
  RTC_DISCONNECT: 'rtc:disconnect',

  // Pairing events
  PAIR_REQUEST: 'pair:request',
  PAIR_RESPONSE: 'pair:response',
  PAIR_QR: 'pair:qr',

  // System events
  ERROR: 'error',
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
} as const;

/** Type-safe event name type */
export type WSEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
