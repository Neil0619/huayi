import {
  SCHEMA_VERSION,
  analysisResultSchema,
  hostEventSchema,
  hostRequestSchema,
} from "@huayi/protocol";
import type { AnalysisError, AnalyzeRequest, HealthRequest, HostEvent } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import { RequestQueue } from "../runtime/request-queue.js";

const HOST_VERSION = "0.1.0";

export type HostEventEmitter = (event: HostEvent) => void;

export interface HealthCheckResult {
  codexVersion: string;
}

export interface NativeMessageDispatcherOptions {
  healthCheck: () => Promise<HealthCheckResult>;
  mapError?: (error: unknown) => AnalysisError;
  maximumConcurrency?: number;
  provider: AnalysisProvider;
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
  private readonly provider: AnalysisProvider;
  private readonly queue: RequestQueue;

  constructor(options: NativeMessageDispatcherOptions) {
    this.provider = options.provider;
    this.healthCheck = options.healthCheck;
    this.mapError = options.mapError ?? defaultError;
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
      case "analyze":
        this.dispatchAnalyze(parsed.data, emit);
        break;
      case "cancel":
        this.dispatchCancel(parsed.data.targetRequestId, emit);
        break;
    }
  }

  dispose(): void {
    this.queue.dispose();
  }

  private dispatchHealth(request: HealthRequest, emit: HostEventEmitter): void {
    void this.healthCheck()
      .then((health) => {
        this.emitValidated(emit, {
          codexVersion: health.codexVersion,
          hostVersion: HOST_VERSION,
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
          const rawResult = await this.provider.analyze(request, signal);
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
