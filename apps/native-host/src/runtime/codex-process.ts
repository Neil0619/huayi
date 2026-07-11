import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const DEFAULT_PROCESS_TIMEOUT_MS = 60_000;
export const DEFAULT_MAXIMUM_OUTPUT_BYTES = 1024 * 1024;

const PROCESS_TERMINATION_GRACE_MS = 1_000;
const ALLOWED_ENVIRONMENT_VARIABLES = [
  "ALL_PROXY",
  "CODEX_HOME",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "USER",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export interface ProcessRunRequest {
  arguments: readonly string[];
  cwd: string;
  env: Readonly<NodeJS.ProcessEnv>;
  executable: string;
  input: string;
  maximumOutputBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}

export class ProcessAbortedError extends Error {
  constructor() {
    super("Process execution was cancelled.");
    this.name = "ProcessAbortedError";
  }
}

export class ProcessTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Process execution exceeded ${timeoutMs} ms.`);
    this.name = "ProcessTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class ProcessOutputLimitError extends Error {
  readonly maximumOutputBytes: number;
  readonly stream: "stderr" | "stdout";

  constructor(stream: "stderr" | "stdout", maximumOutputBytes: number) {
    super(`Process ${stream} exceeded ${maximumOutputBytes} bytes.`);
    this.name = "ProcessOutputLimitError";
    this.maximumOutputBytes = maximumOutputBytes;
    this.stream = stream;
  }
}

export class ProcessSpawnError extends Error {
  constructor(executable: string, cause: unknown) {
    super(`Unable to start executable: ${executable}`, { cause });
    this.name = "ProcessSpawnError";
  }
}

export function buildAllowedEnvironment(source: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const variableName of ALLOWED_ENVIRONMENT_VARIABLES) {
    const value = source[variableName];
    if (value !== undefined) {
      environment[variableName] = value;
    }
  }
  return environment;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (typeof chunk === "string") {
    return Buffer.from(chunk);
  }
  throw new TypeError("Process output must be a Buffer or string.");
}

export class NodeProcessRunner implements ProcessRunner {
  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const maximumOutputBytes = request.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES;
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    assertPositiveInteger(maximumOutputBytes, "maximumOutputBytes");
    assertPositiveInteger(timeoutMs, "timeoutMs");

    if (request.signal?.aborted === true) {
      throw new ProcessAbortedError();
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(request.executable, [...request.arguments], {
        cwd: request.cwd,
        env: buildAllowedEnvironment(request.env),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      throw new ProcessSpawnError(request.executable, error);
    }

    return await new Promise<ProcessRunResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminationError: Error | undefined;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const terminate = (error: Error): void => {
        if (terminationError !== undefined) {
          return;
        }
        terminationError = error;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TERMINATION_GRACE_MS);
        forceKillTimer.unref();
      };

      const capture = (stream: "stderr" | "stdout", chunk: unknown): void => {
        if (terminationError !== undefined) {
          return;
        }
        const buffer = toBuffer(chunk);
        if (stream === "stdout") {
          stdoutBytes += buffer.byteLength;
          if (stdoutBytes > maximumOutputBytes) {
            terminate(new ProcessOutputLimitError(stream, maximumOutputBytes));
            return;
          }
          stdoutChunks.push(buffer);
          return;
        }

        stderrBytes += buffer.byteLength;
        if (stderrBytes > maximumOutputBytes) {
          terminate(new ProcessOutputLimitError(stream, maximumOutputBytes));
          return;
        }
        stderrChunks.push(buffer);
      };

      const abort = (): void => terminate(new ProcessAbortedError());
      const timeoutTimer = setTimeout(
        () => terminate(new ProcessTimeoutError(timeoutMs)),
        timeoutMs,
      );
      timeoutTimer.unref();

      const cleanup = (): void => {
        clearTimeout(timeoutTimer);
        if (forceKillTimer !== undefined) {
          clearTimeout(forceKillTimer);
        }
        request.signal?.removeEventListener("abort", abort);
      };

      request.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: unknown) => capture("stdout", chunk));
      child.stderr.on("data", (chunk: unknown) => capture("stderr", chunk));
      child.stdin.on("error", () => undefined);
      child.once("error", (error: Error) => {
        terminationError ??= new ProcessSpawnError(request.executable, error);
      });
      child.once("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        if (terminationError !== undefined) {
          reject(terminationError);
          return;
        }
        resolve({
          exitCode,
          signal,
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        });
      });

      child.stdin.end(request.input);
    });
  }
}
