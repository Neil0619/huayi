import { hostEventSchema, hostRequestSchema } from "@huayi/protocol";
import type { HostEvent, HostRequest } from "@huayi/protocol";

export const NATIVE_HOST_NAME = "com.huayi.codex_bridge";

export type NativeDisconnectReason = "host-unavailable" | "disconnected" | "invalid-message";

export interface NativeDisconnect {
  message?: string;
  reason: NativeDisconnectReason;
}

export interface NativeTransport {
  onDisconnect(listener: (disconnect: NativeDisconnect) => void): () => void;
  onEvent(listener: (event: HostEvent) => void): () => void;
  send(request: HostRequest): void;
}

interface ListenerEvent<Arguments extends unknown[]> {
  addListener(listener: (...arguments_: Arguments) => void): void;
}

export interface NativePortLike {
  disconnect(): void;
  onDisconnect: ListenerEvent<[]>;
  onMessage: ListenerEvent<[unknown]>;
  postMessage(message: unknown): void;
}

export interface ChromeNativeTransportOptions {
  connectNative: (hostName: string) => NativePortLike;
  readLastError: () => string | undefined;
}

function createChromePort(hostName: string): NativePortLike {
  const port = chrome.runtime.connectNative(hostName);
  return {
    disconnect: () => port.disconnect(),
    onDisconnect: {
      addListener: (listener) => port.onDisconnect.addListener(listener),
    },
    onMessage: {
      addListener: (listener) => port.onMessage.addListener(listener),
    },
    postMessage: (message) => port.postMessage(message),
  };
}

const defaultOptions: ChromeNativeTransportOptions = {
  connectNative: createChromePort,
  readLastError: () => chrome.runtime.lastError?.message,
};

export class ChromeNativeTransport implements NativeTransport {
  private readonly disconnectListeners = new Set<(disconnect: NativeDisconnect) => void>();
  private readonly eventListeners = new Set<(event: HostEvent) => void>();
  private readonly options: ChromeNativeTransportOptions;
  private port: NativePortLike | null = null;

  constructor(options: ChromeNativeTransportOptions = defaultOptions) {
    this.options = options;
  }

  onDisconnect(listener: (disconnect: NativeDisconnect) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  onEvent(listener: (event: HostEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  send(request: HostRequest): void {
    const validatedRequest = hostRequestSchema.parse(request);
    this.ensurePort().postMessage(validatedRequest);
  }

  dispose(): void {
    const activePort = this.port;
    this.port = null;
    activePort?.disconnect();
    this.disconnectListeners.clear();
    this.eventListeners.clear();
  }

  private ensurePort(): NativePortLike {
    if (this.port !== null) {
      return this.port;
    }

    const port = this.options.connectNative(NATIVE_HOST_NAME);
    this.port = port;
    port.onMessage.addListener((message) => this.handleMessage(port, message));
    port.onDisconnect.addListener(() => this.handleDisconnect(port));
    return port;
  }

  private handleMessage(port: NativePortLike, message: unknown): void {
    if (this.port !== port) {
      return;
    }

    const parsed = hostEventSchema.safeParse(message);
    if (!parsed.success) {
      this.port = null;
      port.disconnect();
      this.notifyDisconnect({
        message: "Native host returned an invalid message.",
        reason: "invalid-message",
      });
      return;
    }

    for (const listener of this.eventListeners) {
      listener(parsed.data);
    }
  }

  private handleDisconnect(port: NativePortLike): void {
    if (this.port !== port) {
      return;
    }

    this.port = null;
    const message = this.options.readLastError();
    const normalizedMessage = message?.toLowerCase() ?? "";
    const reason =
      normalizedMessage.includes("not found") ||
      normalizedMessage.includes("specified native messaging host")
        ? "host-unavailable"
        : "disconnected";
    this.notifyDisconnect({ ...(message === undefined ? {} : { message }), reason });
  }

  private notifyDisconnect(disconnect: NativeDisconnect): void {
    for (const listener of this.disconnectListeners) {
      listener(disconnect);
    }
  }
}
