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
  schemaVersion: 5,
  type: "health",
};

const warmupRequest: HostRequest = {
  requestId: "warmup-1",
  schemaVersion: 5,
  type: "warmup",
};

describe("ChromeNativeTransport", () => {
  it("sends a page-data-free warmup and accepts its ready terminal", () => {
    const port = new FakeNativePort();
    const received: string[] = [];
    const transport = new ChromeNativeTransport({
      connectNative: () => port,
      readLastError: () => undefined,
    });
    transport.onEvent((event) => received.push(event.type));

    transport.send(warmupRequest);
    port.onMessage.emit({ ...warmupRequest, type: "warmup-ready" });

    expect(port.messages).toEqual([warmupRequest]);
    expect(Object.keys(port.messages[0] as object).sort()).toEqual([
      "requestId",
      "schemaVersion",
      "type",
    ]);
    expect(received).toEqual(["warmup-ready"]);
  });

  it("connects lazily to the fixed host and validates received events", () => {
    const port = new FakeNativePort();
    const hostNames: string[] = [];
    const received: unknown[] = [];
    const transport = new ChromeNativeTransport({
      connectNative: (hostName) => {
        hostNames.push(hostName);
        return port;
      },
      readLastError: () => undefined,
    });
    transport.onEvent((event) => received.push(event));

    transport.send(healthRequest);
    const healthResult = {
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.10.0",
      model: "gpt-5.4-mini",
      provider: "codex",
      ready: true,
      requestId: "health-1",
      schemaVersion: 5,
      type: "health-result",
    } as const;
    port.onMessage.emit(healthResult);

    expect(hostNames).toEqual([NATIVE_HOST_NAME]);
    expect(port.messages).toEqual([healthRequest]);
    expect(received).toEqual([healthResult]);
  });

  it.each([
    ["official OpenAI", "openai-responses", "gpt-5.6-luna"],
    ["compatible HTTP", "openai-compatible-http", "gpt-5.4-mini"],
  ] as const)(
    "accepts %s health without endpoint or credential fields",
    (_name, provider, model) => {
      const port = new FakeNativePort();
      const received: unknown[] = [];
      const transport = new ChromeNativeTransport({
        connectNative: () => port,
        readLastError: () => undefined,
      });
      transport.onEvent((event) => received.push(event));

      transport.send(healthRequest);
      port.onMessage.emit({
        codexVersion: null,
        hostVersion: "0.10.0",
        model,
        provider,
        ready: true,
        requestId: "health-1",
        schemaVersion: 5,
        type: "health-result",
      });

      expect(received).toEqual([
        {
          codexVersion: null,
          hostVersion: "0.10.0",
          model,
          provider,
          ready: true,
          requestId: "health-1",
          schemaVersion: 5,
          type: "health-result",
        },
      ]);
    },
  );

  it.each([
    ["an unknown Provider", { provider: "unknown-provider", schemaVersion: 5 }],
    ["wire v3", { schemaVersion: 3 }],
    ["an endpoint", { endpoint: "http://third-party.example/v1", schemaVersion: 5 }],
    ["a credential", { credential: "must-stay-host-private", schemaVersion: 5 }],
  ])("rejects compatible HTTP health with %s", (_name, overrides) => {
    const port = new FakeNativePort();
    const reasons: string[] = [];
    const transport = new ChromeNativeTransport({
      connectNative: () => port,
      readLastError: () => undefined,
    });
    transport.onDisconnect((disconnect) => reasons.push(disconnect.reason));

    transport.send(healthRequest);
    port.onMessage.emit({
      codexVersion: null,
      hostVersion: "0.10.0",
      model: "gpt-5.4-mini",
      provider: "openai-compatible-http",
      ready: true,
      requestId: "health-1",
      type: "health-result",
      ...overrides,
    });

    expect(port.disconnected).toBe(true);
    expect(reasons).toEqual(["invalid-message"]);
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
