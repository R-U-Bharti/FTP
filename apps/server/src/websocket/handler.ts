import type { Server, Socket } from "socket.io";
import { EVENTS } from "./events.js";
import type { DiscoveryService } from "../services/discovery.js";
import type { TransferManager } from "../services/transferManager.js";
import type { SessionManager } from "../services/sessionManager.js";

/**
 * Set up all Socket.IO event handlers.
 * Bridges discovery service events to connected WebSocket clients,
 * handles transfer approval flow, and relays WebRTC signaling.
 */
export function setupWebSocketHandlers(
  io: Server,
  discovery: DiscoveryService,
  transferManager: TransferManager,
  sessionManager: SessionManager,
): void {
  // Forward discovery events to all connected clients
  discovery.on("device:discovered", device => {
    io.emit(EVENTS.DEVICE_DISCOVERED, device);
  });

  discovery.on("device:lost", data => {
    io.emit(EVENTS.DEVICE_LOST, data);
  });

  // Forward transfer events to all connected clients
  transferManager.on("progress", transfer => {
    io.emit(EVENTS.TRANSFER_PROGRESS, transfer);
  });

  transferManager.on("complete", transfer => {
    io.emit(EVENTS.TRANSFER_COMPLETE, transfer);
  });

  transferManager.on("error", transfer => {
    io.emit(EVENTS.TRANSFER_ERROR, transfer);
  });

  const webDevices = new Map<string, any>();

  io.on("connection", (socket: Socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Create a transient device for this browser client
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const realIp = typeof forwarded === "string" ? forwarded.split(",")[0] : socket.handshake.address;
    const clientIp = realIp.replace("::ffff:", "");
    const userAgent = socket.handshake.headers["user-agent"] || "";
    
    const isMobile = /mobile/i.test(userAgent);
    const isExpoApp = socket.handshake.query.clientType === 'expo-app';
    
    let deviceName = isMobile ? "Mobile Browser" : "Web Browser";
    if (isExpoApp) deviceName = "Mobile App";

    const webDevice: Device = {
      id: `web-${clientIp}`,
      name: deviceName,
      ip: clientIp,
      port: 0,
      platform: isExpoApp ? "android" : "web",
      deviceType: isMobile || isExpoApp ? "mobile" : "desktop",
      online: true,
      lastSeen: Date.now(),
      isWebClient: !isExpoApp,
      isExpoApp: isExpoApp
    };

    webDevices.set(socket.id, webDevice);
    
    // Notify others about this web client
    io.emit(EVENTS.DEVICE_DISCOVERED, webDevice);

    // Send combined list (UDP discovered + Web clients), excluding self
    const allDevices = [
      ...discovery.getDevices(), 
      ...Array.from(webDevices.values()).filter(d => d.id !== `web-${socket.id}`)
    ];
    socket.emit(EVENTS.DEVICE_LIST, allDevices);

    // Send current active transfers
    const activeTransfers = transferManager.getActiveTransfers();
    if (activeTransfers.length > 0) {
      activeTransfers.forEach(t => socket.emit(EVENTS.TRANSFER_PROGRESS, t));
    }

    // Handle transfer approval/rejection
    socket.on(
      EVENTS.TRANSFER_APPROVE,
      (data: { transferId: string; approved: boolean }) => {
        const transfer = transferManager.getTransfer(data.transferId);
        if (!transfer) return;

        if (data.approved) {
          transferManager.updateStatus(data.transferId, "approved");
          io.emit(EVENTS.TRANSFER_START, transfer);
        } else {
          transferManager.updateStatus(data.transferId, "cancelled");
          io.emit(EVENTS.TRANSFER_CANCEL, transfer);
        }
      },
    );

    // Handle transfer cancellation
    socket.on(EVENTS.TRANSFER_CANCEL, (data: { transferId: string }) => {
      transferManager.failTransfer(data.transferId, "Cancelled by user");
    });

    // ── WebRTC Signaling Relay ──
    socket.on(EVENTS.RTC_OFFER, (data: { targetId: string; sdp: unknown }) => {
      io.emit(EVENTS.RTC_OFFER, { from: socket.id, sdp: data.sdp });
    });

    socket.on(EVENTS.RTC_ANSWER, (data: { targetId: string; sdp: unknown }) => {
      io.emit(EVENTS.RTC_ANSWER, { from: socket.id, sdp: data.sdp });
    });

    socket.on(
      EVENTS.RTC_ICE_CANDIDATE,
      (data: { targetId: string; candidate: unknown }) => {
        io.emit(EVENTS.RTC_ICE_CANDIDATE, {
          from: socket.id,
          candidate: data.candidate,
        });
      },
    );

    // ── Pairing ──
    socket.on(EVENTS.PAIR_REQUEST, (data: { code: string }) => {
      const result = sessionManager.consumePairingCode(data.code);
      if (result) {
        const token = sessionManager.createSession(
          result.deviceId,
          "Paired Device",
        );
        socket.emit("pair:response", { success: true, token, ...result });
      } else {
        socket.emit("pair:response", {
          success: false,
          error: "Invalid or expired code",
        });
      }
    });

    socket.on("device:leave", () => {
      // Remove from broadcast list but keep in session
      const device = discovery.getDevices().get(socket.id);
      if (device) {
        device.online = false;
        io.emit("devices:update", Array.from(discovery.getDevices().values()));
      }
    });

    // --- Proxy Events for Mobile App ---
    socket.on("proxy:file_list", (data: { targetDeviceId: string, path: string, clientRequestId?: string }, callback) => {
      let targetSocketId: string | null = null;
      for (const [sId, dev] of webDevices.entries()) {
        if (dev.id === data.targetDeviceId) {
          targetSocketId = sId;
          break;
        }
      }

      if (!targetSocketId) {
        return callback({ error: "Device not found or offline" });
      }

      const requestId = data.clientRequestId || Math.random().toString(36).substring(7);
      
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket) return callback({ error: "Socket disconnected" });
      
      const progressHandler = (progressData: any) => {
        if (progressData.requestId === requestId) {
          socket.emit(`proxy:file_list_progress_${requestId}`, progressData);
        }
      };
      
      const responseHandler = (resData: any) => {
        if (resData.requestId === requestId) {
          targetSocket.removeListener('file:list_response', responseHandler);
          targetSocket.removeListener('file:list_progress', progressHandler);
          callback(resData);
        }
      };
      
      targetSocket.on('file:list_progress', progressHandler);
      targetSocket.on('file:list_response', responseHandler);
      targetSocket.emit('file:list_request', { path: data.path, requestId });
      
      setTimeout(() => {
        targetSocket.removeListener('file:list_response', responseHandler);
        targetSocket.removeListener('file:list_progress', progressHandler);
        callback({ error: "Timeout waiting for mobile app" });
      }, 1000*60*5);
    });

    socket.on("proxy:file_download", (data: { targetDeviceId: string, path: string, clientRequestId?: string, isPreview?: boolean }, callback) => {
      let targetSocketId: string | null = null;
      for (const [sId, dev] of webDevices.entries()) {
        if (dev.id === data.targetDeviceId) {
          targetSocketId = sId;
          break;
        }
      }

      if (!targetSocketId) {
        return callback({ error: "Device not found" });
      }

      const requestId = data.clientRequestId || Math.random().toString(36).substring(7);
      
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket) return callback({ error: "Socket disconnected" });

      const chunkHandler = (chunkData: any) => {
        if (chunkData.requestId === requestId) {
          socket.emit(`proxy:file_download_chunk_${requestId}`, chunkData);
        }
      };

      const responseHandler = (resData: any) => {
        if (resData.requestId === requestId) {
          targetSocket.removeListener('file:download_response', responseHandler);
          targetSocket.removeListener('file:download_chunk', chunkHandler);
          callback(resData);
        }
      };
      
      targetSocket.on('file:download_chunk', chunkHandler);
      targetSocket.on('file:download_response', responseHandler);
      targetSocket.emit('file:download_request', { path: data.path, requestId, isPreview: data.isPreview });
      
      setTimeout(() => {
        targetSocket.removeListener('file:download_response', responseHandler);
        targetSocket.removeListener('file:download_chunk', chunkHandler);
        callback({ error: "Timeout waiting for mobile app download" });
      }, 1000*60*15); // 15 mins for large files
    });

    socket.on("disconnect", () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
      let disconnectedDeviceId = `web-${socket.id}`;
      if (webDevices.has(socket.id)) {
        disconnectedDeviceId = webDevices.get(socket.id).id;
        webDevices.delete(socket.id);
        io.emit(EVENTS.DEVICE_LOST, { deviceId: disconnectedDeviceId });
      }
    });
  });
}
