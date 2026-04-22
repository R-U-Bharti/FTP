/** Socket.IO event name constants — kept in sync with @localdrop/shared-types */
export const EVENTS = {
  DEVICE_DISCOVERED: 'device:discovered',
  DEVICE_LOST: 'device:lost',
  DEVICE_LIST: 'device:list',
  TRANSFER_REQUEST: 'transfer:request',
  TRANSFER_APPROVE: 'transfer:approve',
  TRANSFER_START: 'transfer:start',
  TRANSFER_PROGRESS: 'transfer:progress',
  TRANSFER_COMPLETE: 'transfer:complete',
  TRANSFER_ERROR: 'transfer:error',
  TRANSFER_CANCEL: 'transfer:cancel',
  RTC_OFFER: 'rtc:offer',
  RTC_ANSWER: 'rtc:answer',
  RTC_ICE_CANDIDATE: 'rtc:ice-candidate',
  PAIR_REQUEST: 'pair:request',
  PAIR_QR: 'pair:qr',
} as const;
