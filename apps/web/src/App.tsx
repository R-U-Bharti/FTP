import React, { useState, useCallback, useEffect } from 'react';
import type { Device } from '@localdrop/shared-types';
import { Badge } from '@localdrop/ui';
import { useSocket } from './hooks/useSocket';
import { useDevices } from './hooks/useDevices';
import { useFileTransfer } from './hooks/useFileTransfer';
import DeviceList from './components/DeviceList';
import FileExplorer from './components/FileExplorer';
import TransferPanel from './components/TransferPanel';
import DropZone from './components/DropZone';

/** Main application shell */
export default function App() {
  const { connected } = useSocket();
  const { devices, loading: devicesLoading } = useDevices();
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<{ name: string; ip: string } | null>(null);

  // Build base URL for the selected device's server
  const baseUrl = selectedDevice ? `http://${selectedDevice.ip}:${selectedDevice.port}` : '';
  const { transfers, uploadFile, downloadFile, cancelTransfer, clearCompleted } =
    useFileTransfer(baseUrl);

  // Fetch this device's info
  useEffect(() => {
    fetch('/api/devices/info')
      .then((res) => res.json())
      .then((data) => setDeviceInfo(data))
      .catch(() => {});
  }, []);

  const handleSelectDevice = useCallback((device: Device) => {
    setSelectedDevice((prev) => (prev?.id === device.id ? null : device));
  }, []);

  const handleDownload = useCallback(
    (filePath: string, fileName: string) => {
      if (!selectedDevice) return;
      downloadFile(filePath, fileName);
    },
    [selectedDevice, downloadFile]
  );

  const handleFilesDropped = useCallback(
    (files: File[]) => {
      files.forEach((file) => uploadFile(file));
    },
    [uploadFile]
  );

  // Sidebar collapsed state for mobile
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f] overflow-hidden">
      {/* ── Top Bar ── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-black/40 backdrop-blur-xl z-10">
        <div className="flex items-center gap-3">
          {/* Mobile menu toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-white/5 text-gray-400 cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <span className="text-sm">⚡</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">LocalDrop</h1>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3">
          {deviceInfo && (
            <span className="text-xs text-gray-500 hidden sm:inline">
              {deviceInfo.name} · {deviceInfo.ip}
            </span>
          )}
          <Badge variant={connected ? 'success' : 'error'} pulse={connected}>
            {connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>
      </header>

      {/* ── Main Content ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — Device List */}
        <aside
          className={`
            w-72 border-r border-white/5 bg-black/20 flex-shrink-0
            transition-all duration-300 overflow-hidden
            ${sidebarOpen ? 'max-w-72' : 'max-w-0 lg:max-w-72'}
          `}
        >
          <DeviceList
            devices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={handleSelectDevice}
            loading={devicesLoading}
          />
        </aside>

        {/* Center — File Explorer or Welcome */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedDevice ? (
            <>
              {/* Device header */}
              <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/20 flex items-center justify-center">
                    <span className="text-lg">🖥️</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">{selectedDevice.name}</h2>
                    <p className="text-xs text-gray-500">{selectedDevice.ip}:{selectedDevice.port}</p>
                  </div>
                </div>
              </div>

              {/* File explorer */}
              <div className="flex-1 overflow-hidden">
                <FileExplorer device={selectedDevice} onDownload={handleDownload} />
              </div>

              {/* Drop zone (hidden for web clients since they can't receive HTTP uploads) */}
              {!selectedDevice.isWebClient && (
                <div className="px-5 py-4 border-t border-white/5">
                  <DropZone onFilesDropped={handleFilesDropped} />
                </div>
              )}
            </>
          ) : (
            /* Welcome screen */
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              {/* Animated gradient background */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-indigo-600/8 rounded-full blur-3xl" />
              </div>

              <div className="relative z-10 text-center max-w-md">
                <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-2xl shadow-violet-500/30 animate-float">
                  <span className="text-4xl">⚡</span>
                </div>

                <h2 className="text-2xl font-bold text-white mb-3">
                  Welcome to LocalDrop
                </h2>
                <p className="text-gray-400 mb-8 leading-relaxed">
                  Fast, secure file sharing on your local network. No internet required.
                  Select a device from the sidebar to get started.
                </p>

                {/* Feature highlights */}
                <div className="grid grid-cols-2 gap-3 text-left">
                  {[
                    { icon: '🔒', title: 'Secure', desc: 'Local network only' },
                    { icon: '⚡', title: 'Fast', desc: 'Stream-based transfer' },
                    { icon: '📁', title: 'Browse', desc: 'Remote file explorer' },
                    { icon: '🔄', title: 'Resume', desc: 'Chunked uploads' },
                  ].map((feat) => (
                    <div
                      key={feat.title}
                      className="p-3 flex flex-col items-center justify-center rounded-xl bg-white/[0.03] border border-white/[0.05]"
                    >
                      <span className="text-xl">{feat.icon}</span>
                      <p className="text-xs font-medium text-white mt-1.5">{feat.title}</p>
                      <p className="text-[11px] text-gray-500">{feat.desc}</p>
                    </div>
                  ))}
                </div>

                {/* Upload to self */}
                <div className="mt-8">
                  <DropZone onFilesDropped={handleFilesDropped} />
                </div>
              </div>
            </div>
          )}

          {/* Transfer panel */}
          <TransferPanel
            transfers={transfers}
            onCancel={cancelTransfer}
            onClearCompleted={clearCompleted}
          />
        </main>
      </div>
    </div>
  );
}
