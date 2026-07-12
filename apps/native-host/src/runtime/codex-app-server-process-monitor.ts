import type { JsonRpcProcess } from "./json-rpc-channel.js";

export interface JsonRpcProcessMonitorOptions {
  isClosing(): boolean;
  onProcessFailure(): void;
  onProtocolFailure(): void;
  process: JsonRpcProcess;
}

export class MonitoredJsonRpcProcess implements JsonRpcProcess {
  readonly stderr: NodeJS.ReadableStream;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly #options: JsonRpcProcessMonitorOptions;
  #processFailed = false;

  constructor(options: JsonRpcProcessMonitorOptions) {
    this.#options = options;
    this.stderr = options.process.stderr;
    this.stdin = options.process.stdin;
    this.stdout = options.process.stdout;
    options.process.on("error", () => this.#handleProcessFailure());
    options.process.on("exit", () => this.#handleProcessFailure());
  }

  kill(signal?: NodeJS.Signals): boolean {
    if (!this.#processFailed && !this.#options.isClosing()) {
      this.#options.onProtocolFailure();
    }
    return this.#options.process.kill(signal);
  }

  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(
    event: "error" | "exit",
    listener:
      ((error: Error) => void) | ((code: number | null, signal: NodeJS.Signals | null) => void),
  ): this {
    if (event === "error") {
      this.#options.process.on(event, listener as (error: Error) => void);
    } else {
      this.#options.process.on(
        event,
        listener as (code: number | null, signal: NodeJS.Signals | null) => void,
      );
    }
    return this;
  }

  #handleProcessFailure(): void {
    if (this.#processFailed) return;
    this.#processFailed = true;
    this.#options.onProcessFailure();
  }
}
