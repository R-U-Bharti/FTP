import { useEffect, useState, useCallback } from 'react';
import type { Device } from '@localdrop/shared-types';
import { getSocket } from '../lib/socket';

/** Hook to manage discovered devices via Socket.IO events */
export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const socket = getSocket();

    // Receive full device list on connect
    socket.on('device:list', (list: Device[]) => {
      setDevices(list);
      setLoading(false);
    });

    // New device discovered
    socket.on('device:discovered', (device: Device) => {
      setDevices((prev) => {
        const filtered = prev.filter((d) => d.id !== device.id);
        return [...filtered, device];
      });
    });

    // Device went offline
    socket.on('device:lost', (data: { deviceId: string }) => {
      setDevices((prev) =>
        prev.map((d) =>
          d.id === data.deviceId ? { ...d, online: false } : d
        )
      );
    });

    // Also fetch via REST as fallback
    fetch('/api/devices/list')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setDevices(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    return () => {
      socket.off('device:list');
      socket.off('device:discovered');
      socket.off('device:lost');
    };
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/devices/list');
      const data = await res.json();
      if (Array.isArray(data)) setDevices(data);
    } catch (err) {
      console.error('Failed to refresh devices:', err);
    }
  }, []);

  const onlineDevices = devices.filter((d) => d.online);

  return { devices, onlineDevices, loading, refreshDevices };
}
