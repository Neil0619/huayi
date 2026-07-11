import { homedir } from "node:os";

import { NativeMessageDecoder, encodeNativeMessage } from "./native-host-smoke-helpers.mjs";

export {
  HEALTH_TIMEOUT_MS,
  NativeMessageDecoder,
  createNativeHostSpawnOptions,
  encodeNativeMessage,
  resolveCodexHome,
  validateSmokeResult,
} from "./native-host-smoke-helpers.mjs";

function asError(error) {
  return error instanceof Error ? error : new Error("Unknown native host failure.");
}

function isMissingProcessError(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function defaultProcessGroupExists(groupId) {
  try {
    process.kill(groupId, 0);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false;
    }
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

export class NativeHostClient {
  #child;
  #closePromise;
  #decoder = new NativeMessageDecoder();
  #detachedProcessGroup;
  #diagnostics = "";
  #exitObserved = false;
  #exitPromise;
  #fatalError;
  #gracefulCloseStarted = false;
  #gracefulCloseTimeoutMs;
  #hostEventSchema;
  #initiatedSignals = new Set();
  #killProcess;
  #killTimeoutMs;
  #pending = new Map();
  #processGroupExists;
  #processGroupQuiescent;
  #stdoutFinalized = false;
  #stdoutPromise;
  #terminateTimeoutMs;

  constructor(child, hostEventSchema, options = {}) {
    this.#child = child;
    this.#hostEventSchema = hostEventSchema;
    this.#detachedProcessGroup = options.detachedProcessGroup ?? false;
    this.#gracefulCloseTimeoutMs = options.gracefulCloseTimeoutMs ?? 1_000;
    this.#killProcess = options.killProcess ?? process.kill.bind(process);
    this.#killTimeoutMs = options.killTimeoutMs ?? 1_000;
    this.#processGroupExists = options.processGroupExists ?? defaultProcessGroupExists;
    this.#processGroupQuiescent = !this.#detachedProcessGroup;
    this.#terminateTimeoutMs = options.terminateTimeoutMs ?? 1_000;
    this.#exitPromise = this.#observeExit();
    this.#stdoutPromise = this.#observeStdout();

    child.stdout.on("data", (chunk) => this.#handleOutput(chunk));
    child.stderr.on("data", (chunk) => {
      if (this.#diagnostics.length < 32_000) {
        this.#diagnostics += Buffer.from(chunk).toString("utf8");
      }
    });
    child.stdin.on("error", (error) => this.#latchFatal(error));
    child.stderr.on("error", (error) => this.#latchFatal(error));
    child.once("error", (error) => this.#latchFatal(error));
  }

  get shutdownComplete() {
    return this.#exitObserved && this.#stdoutFinalized && this.#processGroupQuiescent;
  }

  async request(message, expectedType, timeoutMs) {
    if (this.#fatalError !== undefined) {
      throw this.#fatalError;
    }
    if (this.#closePromise !== undefined || this.#exitObserved || this.#stdoutFinalized) {
      const error = new Error("Native host is no longer available for requests.");
      this.#latchFatal(error);
      throw this.#fatalError;
    }
    if (this.#pending.has(message.requestId)) {
      throw new Error(`Duplicate smoke request ID: ${message.requestId}`);
    }

    return new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.#latchFatal(new Error(`Timed out waiting for ${message.requestId}.`));
      }, timeoutMs);
      this.#pending.set(message.requestId, {
        expectedType,
        reject: rejectRequest,
        resolve: resolveRequest,
        timeout,
      });
      try {
        this.#child.stdin.write(encodeNativeMessage(message), (error) => {
          if (error !== null && error !== undefined) {
            this.#latchFatal(error);
          }
        });
      } catch (error) {
        this.#latchFatal(error);
      }
    });
  }

  close() {
    this.#closePromise ??= this.#performClose();
    return this.#closePromise;
  }

  async #performClose() {
    this.#gracefulCloseStarted = true;
    try {
      this.#child.stdin.end();
    } catch (error) {
      this.#latchFatal(error);
    }

    if (
      this.#fatalError === undefined &&
      (await this.#waitForShutdown(this.#gracefulCloseTimeoutMs)) &&
      this.#fatalError === undefined
    ) {
      return;
    }

    const terminateError = this.#signal("SIGTERM");
    if (!(await this.#waitForShutdown(this.#terminateTimeoutMs))) {
      const killError = this.#signal("SIGKILL");
      if (!(await this.#waitForShutdown(this.#killTimeoutMs))) {
        const shutdownError = new Error(
          "Native host did not exit and close stdout, or its process group did not quiesce within the shutdown bound.",
          {
            cause: killError ?? terminateError,
          },
        );
        if (this.#fatalError !== undefined) {
          throw this.#fatalError;
        }
        throw shutdownError;
      }
    }
    if (this.#fatalError !== undefined) {
      throw this.#fatalError;
    }
  }

  #observeExit() {
    return new Promise((resolveExit) => {
      const onExit = (code, signal) => {
        if (this.#exitObserved) {
          return;
        }
        this.#exitObserved = true;
        this.#child.off("exit", onExit);
        this.#child.off("close", onExit);
        const expectedGracefulExit = this.#gracefulCloseStarted && code === 0 && signal === null;
        const expectedEscalatedExit =
          (signal === null && code === 0 && this.#initiatedSignals.size > 0) ||
          (signal !== null && this.#initiatedSignals.has(signal));
        if (this.#pending.size > 0 || (!expectedGracefulExit && !expectedEscalatedExit)) {
          const phase = this.#gracefulCloseStarted
            ? "during graceful shutdown"
            : "before graceful shutdown";
          this.#latchFatal(
            new Error(
              `Native host exited unexpectedly ${phase} (${String(code ?? signal)}): ${this.#safeDiagnostics()}`,
            ),
          );
        }
        resolveExit();
      };

      this.#child.once("exit", onExit);
      this.#child.once("close", onExit);
      const exitCode = this.#child.exitCode;
      const signalCode = this.#child.signalCode;
      if (exitCode !== null || signalCode !== null) {
        onExit(exitCode, signalCode);
      }
    });
  }

  #observeStdout() {
    return new Promise((resolveStdout) => {
      const finalize = () => {
        if (this.#stdoutFinalized) {
          return;
        }
        this.#stdoutFinalized = true;
        try {
          this.#decoder.finish();
        } catch (error) {
          this.#latchFatal(error);
        }
        if (this.#pending.size > 0 && this.#fatalError === undefined) {
          this.#latchFatal(new Error("Native host stdout ended before completing requests."));
        }
        resolveStdout();
      };

      this.#child.stdout.once("end", finalize);
      this.#child.stdout.once("close", finalize);
      this.#child.stdout.once("error", (error) => this.#latchFatal(error));
      if (this.#child.stdout.readableEnded || this.#child.stdout.destroyed) {
        finalize();
      }
    });
  }

  #handleOutput(chunk) {
    let messages;
    try {
      messages = this.#decoder.push(chunk);
    } catch (error) {
      this.#latchFatal(error);
      return;
    }
    for (const message of messages) {
      let event;
      try {
        event = this.#hostEventSchema.parse(message);
      } catch (error) {
        this.#latchFatal(error);
        return;
      }
      const pending = this.#pending.get(event.requestId);
      if (pending === undefined) {
        this.#latchFatal(new Error(`Unexpected event for ${event.requestId}.`));
        return;
      }
      if (event.type === "progress") {
        continue;
      }
      if (event.type === "error") {
        this.#settle(
          event.requestId,
          undefined,
          new Error(`${event.error.code}: ${event.error.message}`),
        );
      } else if (event.type === pending.expectedType) {
        this.#settle(event.requestId, event, undefined);
      } else {
        this.#latchFatal(new Error(`Unexpected terminal event type: ${event.type}`));
        return;
      }
    }
  }

  #settle(requestId, event, error) {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(requestId);
    if (error !== undefined) {
      pending.reject(error);
    } else {
      pending.resolve(event);
    }
  }

  #latchFatal(error) {
    this.#fatalError ??= asError(error);
    for (const requestId of [...this.#pending.keys()]) {
      this.#settle(requestId, undefined, this.#fatalError);
    }
  }

  async #waitForShutdown(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (this.#exitObserved && this.#stdoutFinalized && this.#refreshProcessGroupQuiescence()) {
        return true;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return false;
      }
      const waitMs = Math.min(10, remainingMs);
      const delay = new Promise((resolveDelay) => setTimeout(resolveDelay, waitMs));
      if (!this.#exitObserved || !this.#stdoutFinalized) {
        await Promise.race([Promise.all([this.#exitPromise, this.#stdoutPromise]), delay]);
      } else {
        await delay;
      }
    }
  }

  #refreshProcessGroupQuiescence() {
    if (this.#processGroupQuiescent) {
      return true;
    }
    const pid = this.#child.pid;
    if (!Number.isInteger(pid) || pid <= 0) {
      this.#latchFatal(new Error("Cannot probe native host process group: PID is unavailable."));
      return false;
    }
    try {
      this.#processGroupQuiescent = !this.#processGroupExists(-pid);
    } catch (error) {
      this.#latchFatal(error);
    }
    return this.#processGroupQuiescent;
  }

  #signal(signal) {
    const pid = this.#child.pid;
    if (!Number.isInteger(pid) || pid <= 0) {
      return new Error(`Cannot send ${signal}: native host PID is unavailable.`);
    }
    this.#initiatedSignals.add(signal);
    try {
      this.#killProcess(this.#detachedProcessGroup ? -pid : pid, signal);
      return undefined;
    } catch (error) {
      this.#initiatedSignals.delete(signal);
      return isMissingProcessError(error) ? undefined : asError(error);
    }
  }

  #safeDiagnostics() {
    return this.#diagnostics.trim().replaceAll(homedir(), "~").slice(0, 2_000);
  }
}
