/**
 * WebRTC peer-to-peer connection manager for direct file transfers.
 * Uses DataChannels for binary data transfer between browsers.
 * No STUN/TURN needed on LAN — only local ICE candidates.
 */

import { getSocket } from './socket';

const CHUNK_SIZE = 64 * 1024; // 64KB — safe DataChannel chunk size

interface WebRTCTransferCallbacks {
  onProgress?: (progress: number) => void;
  onComplete?: (blob: Blob) => void;
  onError?: (error: string) => void;
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private receivedChunks: ArrayBuffer[] = [];
  private expectedSize = 0;
  private receivedSize = 0;
  private callbacks: WebRTCTransferCallbacks = {};

  /** Create a peer connection (no STUN/TURN for LAN) */
  createConnection(): RTCPeerConnection {
    this.pc = new RTCPeerConnection({
      iceServers: [], // No STUN/TURN needed on local network
    });

    const socket = getSocket();

    // Relay ICE candidates via signaling server
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('rtc:ice-candidate', { candidate: event.candidate });
      }
    };

    // Handle incoming data channels (receiver side)
    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    return this.pc;
  }

  /** Create offer (sender initiates) */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) this.createConnection();

    // Create data channel for file transfer
    this.dataChannel = this.pc!.createDataChannel('fileTransfer', {
      ordered: true,
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    return offer;
  }

  /** Handle received offer (receiver side) */
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) this.createConnection();
    await this.pc!.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);
    return answer;
  }

  /** Handle received answer (sender side) */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc!.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /** Add ICE candidate from remote peer */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    await this.pc!.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /** Send a file via DataChannel */
  async sendFile(file: File, callbacks: WebRTCTransferCallbacks): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      callbacks.onError?.('DataChannel not ready');
      return;
    }

    // Send metadata first
    this.dataChannel.send(JSON.stringify({
      type: 'file-meta',
      name: file.name,
      size: file.size,
      mimeType: file.type,
    }));

    let offset = 0;
    const channel = this.dataChannel;

    const sendNextChunk = () => {
      while (offset < file.size) {
        // Wait for buffer to drain (backpressure)
        if (channel.bufferedAmount > 16 * CHUNK_SIZE) {
          setTimeout(sendNextChunk, 50);
          return;
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = file.slice(offset, end);

        chunk.arrayBuffer().then((buffer) => {
          channel.send(buffer);
        });

        offset = end;
        callbacks.onProgress?.((offset / file.size) * 100);
      }

      // Send end marker
      channel.send(JSON.stringify({ type: 'file-end' }));
      callbacks.onComplete?.(new Blob([file]));
    };

    sendNextChunk();
  }

  /** Set up data channel event handlers */
  private setupDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log('[WebRTC] DataChannel open');
    };

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file-meta') {
          this.receivedChunks = [];
          this.expectedSize = msg.size;
          this.receivedSize = 0;
        } else if (msg.type === 'file-end') {
          const blob = new Blob(this.receivedChunks);
          this.callbacks.onComplete?.(blob);
          this.receivedChunks = [];
        }
      } else {
        // Binary chunk
        this.receivedChunks.push(event.data);
        this.receivedSize += event.data.byteLength;
        const progress = this.expectedSize > 0
          ? (this.receivedSize / this.expectedSize) * 100
          : 0;
        this.callbacks.onProgress?.(progress);
      }
    };

    channel.onerror = (err) => {
      console.error('[WebRTC] DataChannel error:', err);
      this.callbacks.onError?.('DataChannel error');
    };

    channel.onclose = () => {
      console.log('[WebRTC] DataChannel closed');
    };
  }

  /** Set receive callbacks */
  onReceive(callbacks: WebRTCTransferCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Close the connection */
  close(): void {
    this.dataChannel?.close();
    this.pc?.close();
    this.pc = null;
    this.dataChannel = null;
  }
}
