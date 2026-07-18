import {
  SCHEMA_VERSION,
  analysisResultSchema,
  hostEventSchema,
  hostRequestSchema,
  wordbookAddOutcomeSchema,
  wordbookPresenceSchema,
} from "@huayi/protocol";
import type {
  AddWordRequest,
  AnalysisError,
  AnalyzeRequest,
  CheckWordRequest,
  HealthRequest,
  HostEvent,
  ModelProvider,
  WarmupRequest,
} from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import { RequestQueue } from "../runtime/request-queue.js";
import type { WordbookProvider } from "../wordbook/wordbook-provider.js";

const HOST_VERSION = "0.10.0";

export type HostEventEmitter = (event: HostEvent) => void;

export interface HealthCheckResult {
  codexVersion: string | null;
  model: string;
  provider: ModelProvider;
}

export interface NativeMessageDispatcherOptions {
  healthCheck: () => Promise<HealthCheckResult>;
  mapError?: (error: unknown) => AnalysisError;
  mapWordbookError?: (error: unknown) => AnalysisError;
  maximumConcurrency?: number;
  provider: AnalysisProvider;
  wordbookProvider?: WordbookProvider;
}

export class InvalidHostRequestError extends Error {
  constructor() {
    super("Invalid host request.");
    this.name = "InvalidHostRequestError";
  }
}

function defaultError(): AnalysisError {
  return {
    code: "INTERNAL_ERROR",
    message: "本机服务处理失败，请重试。",
    retryable: true,
  };
}

export class NativeMessageDispatcher {
  private readonly healthCheck: NativeMessageDispatcherOptions["healthCheck"];
  private readonly mapError: (error: unknown) => AnalysisError;
  private readonly mapWordbookError: (error: unknown) => AnalysisError;
  private readonly provider: AnalysisProvider;
  private readonly queue: RequestQueue;
  private readonly wordbookProvider: WordbookProvider | undefined;
  private disposed = false;

  constructor(options: NativeMessageDispatcherOptions) {
    this.provider = options.provider;
    this.healthCheck = options.healthCheck;
    this.mapError = options.mapError ?? defaultError;
    this.mapWordbookError = options.mapWordbookError ?? defaultError;
    this.wordbookProvider = options.wordbookProvider;
    this.queue = new RequestQueue(options.maximumConcurrency ?? 2);
  }

  dispatch(message: unknown, emit: HostEventEmitter): void {
    const parsed = hostRequestSchema.safeParse(message);
    if (!parsed.success) {
      throw new InvalidHostRequestError();
    }

    switch (parsed.data.type) {
      case "health":
        this.dispatchHealth(parsed.data, emit);
        break;
      case "warmup":
        this.dispatchWarmup(parsed.data, emit);
        break;
      case "analyze":
        this.dispatchAnalyze(parsed.data, emit);
        break;
      case "check-word":
        this.dispatchCheckWord(parsed.data, emit);
        break;
      case "add-word":
        this.dispatchAddWord(parsed.data, emit);
        break;
      case "cancel":
        this.dispatchCancel(parsed.data.targetRequestId, emit);
        break;
      default: {
        const exhaustiveRequest: never = parsed.data;
        return exhaustiveRequest;
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.queue.dispose();
    this.provider.dispose?.();
  }

  private dispatchHealth(request: HealthRequest, emit: HostEventEmitter): void {
    void this.healthCheck()
      .then((health) => {
        this.emitValidated(emit, {
          codexVersion: health.codexVersion,
          hostVersion: HOST_VERSION,
          model: health.model,
          provider: health.provider,
          ready: true,
          requestId: request.requestId,
          schemaVersion: SCHEMA_VERSION,
          type: "health-result",
        });
      })
      .catch((error: unknown) => {
        this.emitError(emit, request.requestId, this.mapError(error));
      });
  }

  private dispatchAnalyze(request: AnalyzeRequest, emit: HostEventEmitter): void {
    this.emitValidated(emit, {
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      stage: "queued",
      type: "progress",
    });

    try {
      this.queue.enqueue(request.requestId, async (signal) => {
        this.emitValidated(emit, {
          requestId: request.requestId,
          schemaVersion: SCHEMA_VERSION,
          stage: "running",
          type: "progress",
        });

        try {
          let sequence = 0;
          const rawResult = await this.provider.analyze(request, signal, (update) => {
            if (signal.aborted) {
              return;
            }
            this.emitValidated(emit, {
              ...update,
              requestId: request.requestId,
              schemaVersion: SCHEMA_VERSION,
              sequence,
            });
            sequence += 1;
          });
          if (signal.aborted) {
            return;
          }

          const result = analysisResultSchema.safeParse(rawResult);
          if (!result.success) {
            this.emitError(emit, request.requestId, {
              code: "INVALID_RESPONSE",
              message: "模型返回了无效结果，请重试。",
              retryable: true,
            });
            return;
          }

          this.emitValidated(emit, {
            requestId: request.requestId,
            result: result.data,
            schemaVersion: SCHEMA_VERSION,
            type: "result",
          });
        } catch (error) {
          if (!signal.aborted) {
            this.emitError(emit, request.requestId, this.mapError(error));
          }
        }
      });
    } catch (error) {
      this.emitError(emit, request.requestId, this.mapError(error));
    }
  }

  private dispatchWarmup(request: WarmupRequest, emit: HostEventEmitter): void {
    try {
      this.queue.enqueue(request.requestId, async (signal) => {
        try {
          await this.provider.warmup(signal);
          if (signal.aborted) return;
          if (!this.queue.markTerminal(request.requestId)) return;
          this.emitValidated(emit, {
            requestId: request.requestId,
            schemaVersion: SCHEMA_VERSION,
            type: "warmup-ready",
          });
        } catch (error) {
          if (!signal.aborted && this.queue.markTerminal(request.requestId)) {
            this.emitError(emit, request.requestId, this.mapError(error));
          }
        }
      });
    } catch (error) {
      this.emitError(emit, request.requestId, this.mapError(error));
    }
  }

  private dispatchCheckWord(request: CheckWordRequest, emit: HostEventEmitter): void {
    const provider = this.wordbookProvider;
    if (provider === undefined) {
      this.emitError(emit, request.requestId, {
        code: "EUDIC_NOT_CONFIGURED",
        message: "尚未配置欧路授权，请先运行配置命令。",
        retryable: false,
      });
      return;
    }
    this.emitValidated(emit, {
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      stage: "queued",
      type: "progress",
    });

    try {
      this.queue.enqueue(request.requestId, async (signal) => {
        this.emitValidated(emit, {
          requestId: request.requestId,
          schemaVersion: SCHEMA_VERSION,
          stage: "running",
          type: "progress",
        });
        try {
          const rawPresence = await provider.checkWord(request, signal);
          if (signal.aborted) {
            return;
          }
          const presence = wordbookPresenceSchema.safeParse(rawPresence);
          if (!presence.success) {
            this.emitError(emit, request.requestId, {
              code: "INVALID_RESPONSE",
              message: "生词本服务返回了无效结果。",
              retryable: false,
            });
            return;
          }
          this.emitValidated(emit, {
            presence: presence.data,
            requestId: request.requestId,
            schemaVersion: SCHEMA_VERSION,
            type: "word-status",
          });
        } catch (error) {
          if (!signal.aborted) {
            this.emitError(emit, request.requestId, this.mapWordbookError(error));
          }
        }
      });
    } catch (error) {
      this.emitError(emit, request.requestId, this.mapWordbookError(error));
    }
  }

  private dispatchCancel(targetRequestId: string, emit: HostEventEmitter): void {
    if (this.queue.cancel(targetRequestId) === null) {
      return;
    }

    this.emitError(emit, targetRequestId, {
      code: "CANCELLED",
      message: "请求已取消。",
      retryable: false,
    });
  }

  private dispatchAddWord(request: AddWordRequest, emit: HostEventEmitter): void {
    const provider = this.wordbookProvider;
    if (provider === undefined) {
      this.emitError(emit, request.requestId, {
        code: "EUDIC_NOT_CONFIGURED",
        message: "尚未配置欧路授权，请先运行配置命令。",
        retryable: false,
      });
      return;
    }
    this.emitValidated(emit, {
      requestId: request.requestId,
      schemaVersion: SCHEMA_VERSION,
      stage: "queued",
      type: "progress",
    });

    try {
      this.queue.enqueue(request.requestId, async (signal) => {
        this.emitValidated(emit, {
          requestId: request.requestId,
          schemaVersion: SCHEMA_VERSION,
          stage: "running",
          type: "progress",
        });
        try {
          const rawOutcome = await provider.addWord(request, signal);
          if (signal.aborted) {
            return;
          }
          const outcome = wordbookAddOutcomeSchema.safeParse(rawOutcome);
          if (!outcome.success) {
            this.emitError(emit, request.requestId, {
              code: "INVALID_RESPONSE",
              message: "生词本服务返回了无效结果。",
              retryable: false,
            });
            return;
          }
          this.emitValidated(emit, {
            outcome: outcome.data,
            requestId: request.requestId,
            schemaVersion: SCHEMA_VERSION,
            type: "word-added",
          });
        } catch (error) {
          if (!signal.aborted) {
            this.emitError(emit, request.requestId, this.mapWordbookError(error));
          }
        }
      });
    } catch (error) {
      this.emitError(emit, request.requestId, this.mapWordbookError(error));
    }
  }

  private emitError(emit: HostEventEmitter, requestId: string, error: AnalysisError): void {
    this.emitValidated(emit, {
      error,
      requestId,
      schemaVersion: SCHEMA_VERSION,
      type: "error",
    });
  }

  private emitValidated(emit: HostEventEmitter, event: HostEvent): void {
    emit(hostEventSchema.parse(event));
  }
}
