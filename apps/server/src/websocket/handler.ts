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
    const clientIp = socket.handshake.address.replace("::ffff:", "");
    const userAgent = socket.handshake.headers["user-agent"] || "";
    
    const isMobile = /mobile/i.test(userAgent);
    const isTablet = /tablet/i.test(userAgent);
    
    const webDevice = {
      id: `web-${socket.id}`,
      name: isMobile ? "Mobile Browser" : isTablet ? "Tablet Browser" : "Web Browser",
      ip: clientIp,
      port: 0, // No server port
      platform: userAgent.split("(")[1]?.split(";")[0] || "Web",
      deviceType: isMobile ? "mobile" : isTablet ? "tablet" : "desktop",
      online: true,
      lastSeen: Date.now(),
      isWebClient: true
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

    socket.on("disconnect", () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
      const deviceId = `web-${socket.id}`;
      if (webDevices.has(socket.id)) {
        webDevices.delete(socket.id);
        io.emit(EVENTS.DEVICE_LOST, { deviceId });
      }
    });
  });
}
