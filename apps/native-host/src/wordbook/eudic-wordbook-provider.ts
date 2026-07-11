import type { AddWordRequest, WordbookAddOutcome } from "@huayi/protocol";

import { EudicProviderError, eudicError } from "./eudic-errors.js";
import type { WordbookProvider } from "./wordbook-provider.js";

export interface EudicAuthorizationReader {
  read(signal: AbortSignal): Promise<string>;
}

export interface EudicWordbookClient {
  addWord(
    authorization: string,
    request: AddWordRequest,
    signal: AbortSignal,
  ): Promise<WordbookAddOutcome>;
}

export interface EudicWordbookProviderOptions {
  authorizationReader: EudicAuthorizationReader;
  client: EudicWordbookClient;
  timeoutMs?: number;
}

const DEFAULT_EUDIC_TIMEOUT_MS = 10_000;

class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(eudicError("CANCELLED"));
    }
    const execution = this.tail.then(async () => {
      if (signal.aborted) {
        throw eudicError("CANCELLED");
      }
      return operation();
    });
    this.tail = execution.then(
      () => undefined,
      () => undefined,
    );

    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(eudicError("CANCELLED"));
      signal.addEventListener("abort", abort, { once: true });
      void execution
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }
}

export class EudicWordbookProvider implements WordbookProvider {
  private readonly authorizationReader: EudicAuthorizationReader;
  private readonly client: EudicWordbookClient;
  private readonly queue = new SerialOperationQueue();
  private readonly timeoutMs: number;

  constructor(options: EudicWordbookProviderOptions) {
    if (!Number.isSafeInteger(options.timeoutMs ?? DEFAULT_EUDIC_TIMEOUT_MS)) {
      throw new RangeError("Eudic timeout must be a positive integer.");
    }
    this.authorizationReader = options.authorizationReader;
    this.client = options.client;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_EUDIC_TIMEOUT_MS;
    if (this.timeoutMs < 1) {
      throw new RangeError("Eudic timeout must be a positive integer.");
    }
  }

  addWord(request: AddWordRequest, signal: AbortSignal): Promise<WordbookAddOutcome> {
    return this.queue.run(() => this.execute(request, signal), signal);
  }

  private async execute(request: AddWordRequest, signal: AbortSignal): Promise<WordbookAddOutcome> {
    if (signal.aborted) {
      throw eudicError("CANCELLED");
    }
    let authorization: string;
    try {
      authorization = await this.authorizationReader.read(signal);
    } catch (error) {
      if (signal.aborted) {
        throw eudicError("CANCELLED", error);
      }
      throw error instanceof EudicProviderError ? error : eudicError("INTERNAL_ERROR", error);
    }

    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    timeout.unref();

    try {
      return await this.client.addWord(authorization, request, controller.signal);
    } catch (error) {
      if (signal.aborted) {
        throw eudicError("CANCELLED", error);
      }
      if (timedOut) {
        throw eudicError("TIMEOUT", error);
      }
      throw error instanceof EudicProviderError ? error : eudicError("INTERNAL_ERROR", error);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
}
