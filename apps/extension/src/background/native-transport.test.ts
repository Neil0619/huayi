import { describe, expect, it } from "vitest";

import type { HostRequest } from "@huayi/protocol";

import {
  ChromeNativeTransport,
  NATIVE_HOST_NAME,
  type NativePortLike,
} from "./native-transport.js";

class FakeEvent<Arguments extends unknown[]> {
  private readonly listeners = new Set<(...arguments_: Arguments) => void>();

  addListener(listener: (...arguments_: Arguments) => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: (...arguments_: Arguments) => void): void {
    this.listeners.delete(listener);
  }

  emit(...arguments_: Arguments): void {
    for (const listener of this.listeners) {
      listener(...arguments_);
    }
  }
}

class FakeNativePort implements NativePortLike {
  readonly messages: unknown[] = [];
  readonly onDisconnect = new FakeEvent<[]>();
  readonly onMessage = new FakeEvent<[unknown]>();
  disconnected = false;

  disconnect(): void {
    this.disconnected = true;
    this.onDisconnect.emit();
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

const healthRequest: HostRequest = {
  requestId: "health-1",
  schemaVersion: 2,
  type: "health",
};

describe("ChromeNativeTransport", () => {
  it("connects lazily to the fixed host and validates received events", () => {
    const port = new FakeNativePort();
    const hostNames: string[] = [];
    const received: string[] = [];
    const transport = new ChromeNativeTransport({
      connectNative: (hostName) => {
        hostNames.push(hostName);
        return port;
      },
      readLastError: () => undefined,
    });
    transport.onEvent((event) => received.push(event.type));

    transport.send(healthRequest);
    port.onMessage.emit({
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.1.0",
      ready: true,
      requestId: "health-1",
      schemaVersion: 2,
      type: "health-result",
    });

    expect(hostNames).toEqual([NATIVE_HOST_NAME]);
    expect(port.messages).toEqual([healthRequest]);
    expect(received).toEqual(["health-result"]);
  });

  it("fails closed on invalid host messages", () => {
    const port = new FakeNativePort();
    const reasons: string[] = [];
    const transport = new ChromeNativeTransport({
      connectNative: () => port,
      readLastError: () => undefined,
    });
    transport.onDisconnect((disconnect) => reasons.push(disconnect.reason));
    transport.send(healthRequest);

    port.onMessage.emit({ html: "<script>", type: "result" });

    expect(port.disconnected).toBe(true);
    expect(reasons).toEqual(["invalid-message"]);
  });

  it("creates a fresh port after disconnection", () => {
    const ports = [new FakeNativePort(), new FakeNativePort()];
    let connectionCount = 0;
    const transport = new ChromeNativeTransport({
      connectNative: () => {
        const port = ports[connectionCount];
        connectionCount += 1;
        if (port === undefined) {
          throw new Error("Unexpected connection.");
        }
        return port;
      },
      readLastError: () => "Native host has exited.",
    });

    transport.send(healthRequest);
    ports[0]?.onDisconnect.emit();
    transport.send({ ...healthRequest, requestId: "health-2" });

    expect(connectionCount).toBe(2);
    expect(ports[1]?.messages).toEqual([{ ...healthRequest, requestId: "health-2" }]);
  });
});
