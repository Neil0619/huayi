import type {
  AddWordRequest,
  CheckWordRequest,
  WordbookAddOutcome,
  WordbookPresence,
} from "@huayi/protocol";

import {
  EudicOperationExecutor,
  type EudicAuthorizationReader,
  type EudicOperationExecutorLike,
} from "./eudic-operation-executor.js";
import type { WordbookProvider } from "./wordbook-provider.js";

export type { EudicAuthorizationReader } from "./eudic-operation-executor.js";

export interface EudicWordbookClient {
  addWord(
    authorization: string,
    request: AddWordRequest,
    signal: AbortSignal,
  ): Promise<WordbookAddOutcome>;
  checkWord(
    authorization: string,
    request: CheckWordRequest,
    signal: AbortSignal,
  ): Promise<WordbookPresence>;
}

export interface EudicWordbookProviderOptions {
  authorizationReader?: EudicAuthorizationReader;
  client: EudicWordbookClient;
  operationExecutor?: EudicOperationExecutorLike;
  timeoutMs?: number;
}

export class EudicWordbookProvider implements WordbookProvider {
  private readonly client: EudicWordbookClient;
  private readonly operationExecutor: EudicOperationExecutorLike;

  constructor(options: EudicWordbookProviderOptions) {
    this.client = options.client;
    if (options.operationExecutor !== undefined) {
      this.operationExecutor = options.operationExecutor;
      return;
    }
    if (options.authorizationReader === undefined) {
      throw new TypeError("Eudic authorization reader is required.");
    }
    this.operationExecutor = new EudicOperationExecutor({
      authorizationReader: options.authorizationReader,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  addWord(request: AddWordRequest, signal: AbortSignal): Promise<WordbookAddOutcome> {
    return this.operationExecutor.execute(
      (authorization, operationSignal) =>
        this.client.addWord(authorization, request, operationSignal),
      signal,
    );
  }

  checkWord(request: CheckWordRequest, signal: AbortSignal): Promise<WordbookPresence> {
    return this.operationExecutor.execute(
      (authorization, operationSignal) =>
        this.client.checkWord(authorization, request, operationSignal),
      signal,
    );
  }
}
