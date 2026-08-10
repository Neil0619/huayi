import { SCHEMA_VERSION, type HostEvent, type ModelProvider } from "@huayi/protocol";
import type { SettingsProviderSelectedEvent, SettingsStatusResultEvent } from "@huayi/protocol";

import type { NativeTransport } from "./native-transport.js";

type SettingsControlResult = SettingsProviderSelectedEvent | SettingsStatusResultEvent;

interface PendingControl {
  expectedType: SettingsControlResult["type"];
  reject(error: Error): void;
  resolve(event: SettingsControlResult): void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export class HostSettingsError extends Error {
  constructor(message = "无法读取本机配置，请确认 Host 已同步升级。") {
    super(message);
    this.name = "HostSettingsError";
  }
}

export interface HostSettingsCoordinatorOptions {
  createRequestId?: () => string;
  timeoutMs?: number;
  transport: NativeTransport;
}

export class HostSettingsCoordinator {
  readonly #createRequestId: () => string;
  readonly #pending = new Map<string, PendingControl>();
  readonly #removeDisconnectListener: () => void;
  readonly #removeEventListener: () => void;
  readonly #timeoutMs: number;
  readonly #transport: NativeTransport;

  constructor(options: HostSettingsCoordinatorOptions) {
    this.#createRequestId = options.createRequestId ?? (() => `settings-${crypto.randomUUID()}`);
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#transport = options.transport;
    this.#removeEventListener = this.#transport.onEvent((event) => this.#handleEvent(event));
    this.#removeDisconnectListener = this.#transport.onDisconnect(() => this.#handleDisconnect());
  }

  status(): Promise<SettingsStatusResultEvent> {
    return this.#request("settings-status-result", (requestId) => ({
      requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "settings-status",
    }));
  }

  selectProvider(provider: ModelProvider): Promise<SettingsProviderSelectedEvent> {
    return this.#request("settings-provider-selected", (requestId) => ({
      provider,
      requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "settings-select-provider",
    }));
  }

  dispose(): void {
    this.#removeEventListener();
    this.#removeDisconnectListener();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new HostSettingsError());
    }
    this.#pending.clear();
  }

  #request<Result extends SettingsControlResult>(
    expectedType: Result["type"],
    createRequest: (requestId: string) => Parameters<NativeTransport["send"]>[0],
  ): Promise<Result> {
    const requestId = this.#createRequestId();
    return new Promise<Result>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new HostSettingsError("本机配置请求超时，请重试。"));
      }, this.#timeoutMs);
      this.#pending.set(requestId, {
        expectedType,
        reject,
        resolve: (event) => resolve(event as Result),
        timeoutId,
      });
      try {
        this.#transport.send(createRequest(requestId));
      } catch {
        clearTimeout(timeoutId);
        this.#pending.delete(requestId);
        reject(new HostSettingsError());
      }
    });
  }

  #handleEvent(event: HostEvent): void {
    const pending = this.#pending.get(event.requestId);
    if (pending === undefined) return;
    clearTimeout(pending.timeoutId);
    this.#pending.delete(event.requestId);
    if (event.type === "error") {
      pending.reject(new HostSettingsError(event.error.message));
      return;
    }
    if (event.type !== pending.expectedType) {
      pending.reject(new HostSettingsError("本机服务返回了不匹配的配置结果。"));
      return;
    }
    pending.resolve(event);
  }

  #handleDisconnect(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new HostSettingsError());
    }
    this.#pending.clear();
  }
}
