import { hostEventSchema, hostRequestSchema } from "@huayi/protocol";
import type { HostEvent, HostRequest } from "@huayi/protocol";

import type { NativeDisconnect, NativeTransport } from "../../src/background/native-transport.js";

type DisconnectListener = (disconnect: NativeDisconnect) => void;
type EventListener = (event: HostEvent) => void;
type RequestListener = (request: HostRequest) => void;

export class MockNativeTransport implements NativeTransport {
  private readonly disconnectListeners = new Set<DisconnectListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly requestListeners = new Set<RequestListener>();

  onDisconnect(listener: DisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onRequest(listener: RequestListener): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  send(request: HostRequest): void {
    const validatedRequest = hostRequestSchema.parse(request);
    for (const listener of this.requestListeners) {
      listener(validatedRequest);
    }
  }

  emit(event: HostEvent): void {
    const validatedEvent = hostEventSchema.parse(event);
    for (const listener of this.eventListeners) {
      listener(validatedEvent);
    }
  }

  disconnect(disconnect: NativeDisconnect): void {
    for (const listener of this.disconnectListeners) {
      listener(disconnect);
    }
  }
}
