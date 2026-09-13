import type {
  ExtensionQueryEventRead,
  ExtensionQueryGenerationRead,
  ExtensionQueryGenerationRequest,
  ModelUsage,
  QuotaSummary,
  StoreAnalysisReadResult,
  AnalysisUpdate,
} from "@huayi/cloud-contracts";
import type { DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";
import type { ModelExecution } from "./model-execution.js";

export interface ExtensionQueryModel {
  run(
    input: ExtensionQueryGenerationRequest,
    generationId: string,
    execution?: Omit<ModelExecution, "onPreview"> & {
      readonly onPreview?: (update: AnalysisUpdate) => void;
    },
  ): Promise<{
    billedCalls?: readonly { costMicroUsd: number; usage: ModelUsage }[];
    costMicroUsd: number;
    result: StoreAnalysisReadResult;
    usage: ModelUsage;
  }>;
}

export type ExtensionQueryClaim =
  | { id: string; kind: "acquired"; leaseToken: string }
  | { id: string; kind: "expired" }
  | { id: string; kind: "running" }
  | { event: ExtensionQueryEventRead; id: string; kind: "terminal" };

export interface ExtensionQueryStore {
  abandon(
    userId: string,
    id: string,
  ): Promise<Extract<ExtensionQueryEventRead, { type: "query.failed" }>>;
  attachReservation(command: {
    id: string;
    leaseToken: string;
    priceVersionId?: string;
    reservationId: string;
    userId: string;
  }): Promise<void>;
  begin(command: {
    expiresAt: Date;
    id: string;
    idempotencyKey: string;
    input: ExtensionQueryGenerationRequest;
    leaseExpiresAt: Date;
    leaseToken: string;
    requestHash: string;
    userId: string;
  }): Promise<ExtensionQueryClaim>;
  complete(command: {
    billedCalls?: readonly { costMicroUsd: number; usage: ModelUsage }[];
    costMicroUsd: number;
    id: string;
    leaseToken: string;
    priceVersionId?: string;
    reservationId: string;
    result: StoreAnalysisReadResult;
    usage: ModelUsage;
    userId: string;
  }): Promise<Extract<ExtensionQueryEventRead, { type: "query.completed" }>>;
  fail(command: {
    billedCalls?: readonly { costMicroUsd: number; usage: ModelUsage }[];
    costMicroUsd?: number;
    error: Extract<ExtensionQueryEventRead, { type: "query.failed" }>["error"];
    id: string;
    leaseToken: string;
    priceVersionId?: string;
    reservationId: string;
    usage?: ModelUsage;
    userId: string;
  }): Promise<Extract<ExtensionQueryEventRead, { type: "query.failed" }>>;
  find(userId: string, id: string): Promise<ExtensionQueryGenerationRead | null>;
  markDispatched(command: {
    dispatchedAt?: Date;
    id: string;
    leaseToken: string;
    pricing?: DeepSeekPriceSnapshot;
    userId: string;
  }): Promise<void>;
  terminalizeWithoutReservation(command: {
    error: Extract<ExtensionQueryEventRead, { type: "query.failed" }>["error"];
    id: string;
    leaseToken: string;
    quota: QuotaSummary;
    userId: string;
  }): Promise<void>;
}

export interface ExtensionQueryQuota {
  reserve(command: {
    pricing?: DeepSeekPriceSnapshot;
    requestId: string;
    reservedMicroUsd: number;
    userId: string;
  }): Promise<{ id: string }>;
  summary(userId: string): Promise<QuotaSummary> | QuotaSummary;
}
