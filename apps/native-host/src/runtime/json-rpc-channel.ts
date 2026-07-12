import { TextDecoder } from "node:util";

export interface JsonRpcProcess {
  readonly stderr: NodeJS.ReadableStream;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type JsonRpcProcessFactory = () => JsonRpcProcess;

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcChannelOptions {
  maximumLineBytes: number;
  process: JsonRpcProcess;
}

interface PendingRequest {
  reject(reason: Error): void;
  resolve(result: unknown): void;
}

type JsonObject = Record<string, unknown>;

const hasOwn = (value: JsonObject, property: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, property);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBuffer(chunk: unknown): Buffer | undefined {
  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return undefined;
}

function isResponseId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function remoteError(error: unknown): Error | undefined {
  if (!isJsonObject(error)) {
    return undefined;
  }

  const { code, message } = error;
  if (typeof code !== "number" || !Number.isFinite(code) || typeof message !== "string") {
    return undefined;
  }

  return new Error(`JSON-RPC error ${String(code)}: ${message}`);
}

export class JsonRpcChannel {
  readonly #maximumLineBytes: number;
  readonly #notificationListeners = new Set<(notification: JsonRpcNotification) => void>();
  readonly #pendingRequests = new Map<number, PendingRequest>();
  readonly #process: JsonRpcProcess;
  readonly #stdoutDecoder = new TextDecoder("utf-8", { fatal: true });

  #disposed = false;
  #disposalReason = new Error("JSON-RPC channel disposed");
  #nextRequestId = 1;
  #stderrBytes = 0;
  #stdoutLineBytes = 0;
  #stdoutLineChunks: Buffer[] = [];
  #terminated = false;

  constructor(options: JsonRpcChannelOptions) {
    if (!Number.isSafeInteger(options.maximumLineBytes) || options.maximumLineBytes <= 0) {
      throw new RangeError("maximumLineBytes must be a positive safe integer");
    }

    this.#maximumLineBytes = options.maximumLineBytes;
    this.#process = options.process;

    this.#process.stdout.on("data", (chunk: unknown) => this.#handleStdout(chunk));
    this.#process.stderr.on("data", (chunk: unknown) => this.#handleStderr(chunk));
    this.#process.stdin.on("error", () => {
      this.#fail(new Error("JSON-RPC stdin stream error"));
    });
    this.#process.stdout.on("error", () => {
      this.#fail(new Error("JSON-RPC stdout stream error"));
    });
    this.#process.stderr.on("error", () => {
      this.#fail(new Error("JSON-RPC stderr stream error"));
    });
    this.#process.on("error", () => {
      this.#fail(new Error("JSON-RPC process error"));
    });
    this.#process.on("exit", () => {
      this.#fail(new Error("JSON-RPC process exited unexpectedly"));
    });
  }

  request<Result>(method: string, params: unknown): Promise<Result> {
    if (this.#disposed) {
      return Promise.reject(this.#disposalReason);
    }
    this.#assertMethod(method);

    const id = this.#nextRequestId;
    this.#nextRequestId += 1;

    const response = new Promise<Result>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        reject,
        resolve: (result) => resolve(result as Result),
      });
    });

    this.#writeEnvelope({ id, method, params });
    return response;
  }

  notify(method: string, params?: unknown): void {
    if (this.#disposed) {
      throw this.#disposalReason;
    }
    this.#assertMethod(method);

    this.#writeEnvelope(params === undefined ? { method } : { method, params });
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): () => void {
    if (this.#disposed) {
      return () => undefined;
    }

    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  dispose(reason = new Error("JSON-RPC channel disposed")): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#disposalReason = reason;
    this.#notificationListeners.clear();
    this.#stdoutLineChunks = [];
    this.#stdoutLineBytes = 0;

    for (const pending of this.#pendingRequests.values()) {
      pending.reject(reason);
    }
    this.#pendingRequests.clear();
    this.#terminate();
  }

  #assertMethod(method: string): void {
    if (method.length === 0) {
      throw new TypeError("JSON-RPC method must not be empty");
    }
  }

  #writeEnvelope(envelope: JsonObject): void {
    let encoded: string;
    try {
      encoded = JSON.stringify(envelope);
    } catch {
      this.#fail(new Error("JSON-RPC request encoding failed"));
      return;
    }

    try {
      this.#process.stdin.write(`${encoded}\n`);
    } catch {
      this.#fail(new Error("JSON-RPC stdin write failed"));
    }
  }

  #handleStdout(chunk: unknown): void {
    if (this.#disposed) {
      return;
    }

    const bytes = toBuffer(chunk);
    if (bytes === undefined) {
      this.#fail(new Error("JSON-RPC stdout emitted a non-byte chunk"));
      return;
    }

    let offset = 0;
    while (offset < bytes.byteLength) {
      const newlineIndex = bytes.indexOf(0x0a, offset);
      const segmentEnd = newlineIndex === -1 ? bytes.byteLength : newlineIndex;
      const segment = bytes.subarray(offset, segmentEnd);

      this.#stdoutLineBytes += segment.byteLength;
      if (this.#stdoutLineBytes > this.#maximumLineBytes) {
        this.#fail(new Error("JSON-RPC stdout line exceeds configured byte limit"));
        return;
      }
      if (segment.byteLength > 0) {
        this.#stdoutLineChunks.push(Buffer.from(segment));
      }

      if (newlineIndex === -1) {
        return;
      }

      const line = Buffer.concat(this.#stdoutLineChunks, this.#stdoutLineBytes);
      this.#stdoutLineChunks = [];
      this.#stdoutLineBytes = 0;
      this.#handleLine(line);
      if (this.#disposed) {
        return;
      }
      offset = newlineIndex + 1;
    }
  }

  #handleStderr(chunk: unknown): void {
    if (this.#disposed) {
      return;
    }

    const bytes = toBuffer(chunk);
    if (bytes === undefined) {
      this.#fail(new Error("JSON-RPC stderr emitted a non-byte chunk"));
      return;
    }

    this.#stderrBytes += bytes.byteLength;
    if (this.#stderrBytes > this.#maximumLineBytes) {
      this.#fail(new Error("JSON-RPC stderr exceeds configured byte limit"));
    }
  }

  #handleLine(line: Buffer): void {
    let decoded: string;
    try {
      decoded = this.#stdoutDecoder.decode(line);
    } catch {
      this.#fail(new Error("Malformed UTF-8 in JSON-RPC stdout"));
      return;
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(decoded) as unknown;
    } catch {
      this.#fail(new Error("Malformed JSON in JSON-RPC stdout"));
      return;
    }

    if (!isJsonObject(envelope)) {
      this.#fail(new Error("JSON-RPC message must be an object envelope"));
      return;
    }

    if (hasOwn(envelope, "id")) {
      this.#handleResponse(envelope);
      return;
    }
    this.#handleNotification(envelope);
  }

  #handleResponse(envelope: JsonObject): void {
    const id = envelope.id;
    const hasResult = hasOwn(envelope, "result");
    const hasError = hasOwn(envelope, "error");
    if (!isResponseId(id) || hasResult === hasError || hasOwn(envelope, "method")) {
      this.#fail(new Error("Malformed JSON-RPC response envelope"));
      return;
    }

    const pending = this.#pendingRequests.get(id);
    if (pending === undefined) {
      this.#fail(new Error(`Unknown JSON-RPC response ID: ${String(id)}`));
      return;
    }

    if (hasError) {
      const error = remoteError(envelope.error);
      if (error === undefined) {
        this.#fail(new Error("Malformed JSON-RPC error envelope"));
        return;
      }
      this.#pendingRequests.delete(id);
      pending.reject(error);
      return;
    }

    this.#pendingRequests.delete(id);
    pending.resolve(envelope.result);
  }

  #handleNotification(envelope: JsonObject): void {
    if (
      typeof envelope.method !== "string" ||
      envelope.method.length === 0 ||
      hasOwn(envelope, "result") ||
      hasOwn(envelope, "error")
    ) {
      this.#fail(new Error("Malformed JSON-RPC notification envelope"));
      return;
    }

    const notification: JsonRpcNotification = hasOwn(envelope, "params")
      ? { method: envelope.method, params: envelope.params }
      : { method: envelope.method };

    for (const listener of [...this.#notificationListeners]) {
      try {
        listener(notification);
      } catch {
        this.#fail(new Error("JSON-RPC notification listener failed"));
        return;
      }
    }
  }

  #fail(reason: Error): void {
    this.dispose(reason);
  }

  #terminate(): void {
    if (this.#terminated) {
      return;
    }

    this.#terminated = true;
    try {
      this.#process.kill();
    } catch {
      // The channel is already closed; process termination is best effort.
    }
  }
}
