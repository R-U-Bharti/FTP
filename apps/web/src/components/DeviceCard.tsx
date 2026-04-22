import React from 'react';
import type { Device } from '@localdrop/shared-types';
import { Badge } from '@localdrop/ui';

interface DeviceCardProps {
  device: Device;
  selected?: boolean;
  onClick?: (device: Device) => void;
}

/** Icons for different device types */
const deviceIcons: Record<string, string> = {
  desktop: '🖥️',
  laptop: '💻',
  mobile: '📱',
  tablet: '📱',
  unknown: '📡',
};

/** Platform display names */
const platformNames: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
};

/** Single device card with status indicator and selection state */
const DeviceCard: React.FC<DeviceCardProps> = React.memo(({ device, selected, onClick }) => {
  return (
    <button
      id={`device-${device.id}`}
      onClick={() => onClick?.(device)}
      className={`
        w-full p-4 rounded-2xl border transition-all duration-300 text-left cursor-pointer
        ${selected
          ? 'bg-violet-500/15 border-violet-500/40 shadow-lg shadow-violet-500/10 animate-pulse-glow'
          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/10'
        }
      `}
    >
      <div className="flex items-center gap-3">
        {/* Device icon with glow */}
        <div className={`
          text-3xl p-2 rounded-xl
          ${selected ? 'bg-violet-500/20' : 'bg-white/5'}
        `}>
          {deviceIcons[device.deviceType] || deviceIcons.unknown}
        </div>

        <div className="flex-1 min-w-0">
          {/* Device name */}
          <p className="font-semibold text-white truncate text-sm">
            {device.name}
          </p>

          {/* Platform & IP */}
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {platformNames[device.platform] || device.platform} · {device.ip}
          </p>
        </div>

        {/* Online status */}
        <Badge
          variant={device.online ? 'success' : 'default'}
          pulse={device.online}
        >
          {device.online ? 'Online' : 'Offline'}
        </Badge>
      </div>
    </button>
  );
});

DeviceCard.displayName = 'DeviceCard';
export default DeviceCard;
