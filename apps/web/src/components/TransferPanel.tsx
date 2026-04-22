import React from 'react';
import type { Transfer } from '@localdrop/shared-types';
import { ProgressBar } from '@localdrop/ui';
import { formatBytes, formatTime } from '../lib/chunkedUpload';

interface TransferItemProps {
  transfer: Transfer;
  onCancel?: (id: string) => void;
}

const statusColors: Record<string, string> = {
  transferring: 'text-violet-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-gray-400',
  pending: 'text-amber-400',
};

const statusIcons: Record<string, string> = {
  upload: '⬆️',
  download: '⬇️',
};

/** Single transfer progress item */
const TransferItem: React.FC<TransferItemProps> = React.memo(({ transfer, onCancel }) => {
  const progressVariant =
    transfer.status === 'completed' ? 'success' :
    transfer.status === 'failed' ? 'error' :
    'default';

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
      {/* Direction icon */}
      <span className="text-lg flex-shrink-0">
        {statusIcons[transfer.direction] || '📄'}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium text-gray-200 truncate">
            {transfer.fileName}
          </p>
          <span className={`text-xs font-medium ${statusColors[transfer.status] || 'text-gray-400'}`}>
            {transfer.status === 'transferring'
              ? `${transfer.progress.toFixed(0)}%`
              : transfer.status.charAt(0).toUpperCase() + transfer.status.slice(1)
            }
          </span>
        </div>

        <ProgressBar
          value={transfer.progress}
          size="sm"
          variant={progressVariant}
          animated={transfer.status === 'transferring'}
        />

        {/* Speed & ETA */}
        {transfer.status === 'transferring' && (
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-[11px] text-gray-500">
              {formatBytes(transfer.speed)}/s
            </span>
            <span className="text-[11px] text-gray-600">
              {formatTime(transfer.eta)} remaining
            </span>
            <span className="text-[11px] text-gray-600">
              {formatBytes(transfer.bytesTransferred)} / {formatBytes(transfer.fileSize)}
            </span>
          </div>
        )}

        {transfer.status === 'failed' && transfer.error && (
          <p className="text-xs text-red-400/70 mt-1">{transfer.error}</p>
        )}
      </div>

      {/* Cancel button */}
      {(transfer.status === 'transferring' || transfer.status === 'pending') && onCancel && (
        <button
          onClick={() => onCancel(transfer.id)}
          className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          title="Cancel"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
});

TransferItem.displayName = 'TransferItem';

// ── Transfer Panel ──

interface TransferPanelProps {
  transfers: Transfer[];
  onCancel: (id: string) => void;
  onClearCompleted: () => void;
}

/** Bottom panel showing all active and recent transfers */
const TransferPanel: React.FC<TransferPanelProps> = ({ transfers, onCancel, onClearCompleted }) => {
  if (transfers.length === 0) return null;

  const active = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'pending'
  );
  const completed = transfers.filter(
    (t) => t.status !== 'transferring' && t.status !== 'pending'
  );

  return (
    <div className="border-t border-white/5 bg-black/30 backdrop-blur-sm animate-slide-up">
      <div className="px-5 py-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Transfers {active.length > 0 && `(${active.length} active)`}
        </h3>
        {completed.length > 0 && (
          <button
            onClick={onClearCompleted}
            className="text-xs text-gray-500 hover:text-white transition-colors cursor-pointer"
          >
            Clear completed
          </button>
        )}
      </div>

      <div className="px-4 pb-4 space-y-2 max-h-60 overflow-y-auto">
        {transfers.map((transfer) => (
          <TransferItem
            key={transfer.id}
            transfer={transfer}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
};

export default TransferPanel;
