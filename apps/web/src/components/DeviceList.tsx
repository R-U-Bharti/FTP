import React from 'react';
import type { Device } from '@localdrop/shared-types';
import DeviceCard from './DeviceCard';

interface DeviceListProps {
  devices: Device[];
  selectedDevice: Device | null;
  onSelectDevice: (device: Device) => void;
  loading: boolean;
}

/** Sidebar device list with discovery animation */
const DeviceList: React.FC<DeviceListProps> = ({ devices, selectedDevice, onSelectDevice, loading }) => {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-white/5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white tracking-wide uppercase">
            Devices
          </h2>
          <span className="text-xs text-gray-500">
            {devices.filter((d) => d.online).length} online
          </span>
        </div>

        {/* Scanning indicator */}
        {loading && (
          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500" />
            </div>
            <span className="text-xs text-violet-400">Scanning network...</span>
          </div>
        )}
      </div>

      {/* Device list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {devices.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-4xl mb-3 animate-float">📡</div>
            <p className="text-sm text-gray-400">No devices found</p>
            <p className="text-xs text-gray-600 mt-1">
              Make sure other devices are on the same network
            </p>
          </div>
        ) : (
          devices.map((device, i) => (
            <div
              key={device.id}
              className="animate-slide-up"
              style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'backwards' }}
            >
              <DeviceCard
                device={device}
                selected={selectedDevice?.id === device.id}
                onClick={onSelectDevice}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DeviceList;
