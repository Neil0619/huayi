import { EudicProviderError, eudicError } from "./eudic-errors.js";

export const DEFAULT_EUDIC_OPERATION_TIMEOUT_MS = 10_000;

export interface EudicAuthorizationReader {
  read(signal: AbortSignal): Promise<string>;
}

export interface EudicOperationExecutorLike {
  execute<T>(
    operation: (authorization: string, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T>;
}

export interface EudicOperationExecutorOptions {
  authorizationReader: EudicAuthorizationReader;
  timeoutMs?: number;
}

export class EudicOperationExecutor implements EudicOperationExecutorLike {
  private readonly authorizationReader: EudicAuthorizationReader;
  private tail: Promise<void> = Promise.resolve();
  private readonly timeoutMs: number;

  constructor(options: EudicOperationExecutorOptions) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_EUDIC_OPERATION_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("Eudic timeout must be a positive integer.");
    }
    this.authorizationReader = options.authorizationReader;
    this.timeoutMs = timeoutMs;
  }

  execute<T>(
    operation: (authorization: string, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(eudicError("CANCELLED"));
    }
    const execution = this.tail.then(() => this.runOperation(operation, signal));
    this.tail = execution.then(
      () => undefined,
      () => undefined,
    );

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        complete();
      };
      const abort = (): void => finish(() => reject(eudicError("CANCELLED")));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      void execution.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  private async runOperation<T>(
    operation: (authorization: string, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) throw eudicError("CANCELLED");

    let authorization: string;
    try {
      authorization = await this.authorizationReader.read(signal);
    } catch (error) {
      if (signal.aborted) throw eudicError("CANCELLED", error);
      throw error instanceof EudicProviderError ? error : eudicError("INTERNAL_ERROR", error);
    }
    if (signal.aborted) throw eudicError("CANCELLED");

    const operationController = new AbortController();
    let timedOut = false;
    const abortOperation = () => operationController.abort();
    signal.addEventListener("abort", abortOperation, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      operationController.abort();
    }, this.timeoutMs);
    timeout.unref();

    try {
      return await operation(authorization, operationController.signal);
    } catch (error) {
      if (signal.aborted) throw eudicError("CANCELLED", error);
      if (timedOut) throw eudicError("TIMEOUT", error);
      throw error instanceof EudicProviderError ? error : eudicError("INTERNAL_ERROR", error);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortOperation);
    }
  }
}
