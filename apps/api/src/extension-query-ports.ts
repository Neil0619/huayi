import type {
  ExtensionQueryEvent,
  ExtensionQueryGeneration,
  ExtensionQueryRequest,
  ModelUsage,
  QuotaSummary,
  StoreAnalysisResult,
  AnalysisUpdate,
} from "@huayi/cloud-contracts";
import type { DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";
import type { ModelExecution } from "./model-execution.js";

export interface ExtensionQueryModel {
  run(
    input: ExtensionQueryRequest,
    generationId: string,
    execution?: Omit<ModelExecution, "onPreview"> & {
      readonly onPreview?: (update: AnalysisUpdate) => void;
    },
  ): Promise<{
    billedCalls?: readonly { costMicroUsd: number; usage: ModelUsage }[];
    costMicroUsd: number;
    result: StoreAnalysisResult;
    usage: ModelUsage;
  }>;
}

export type ExtensionQueryClaim =
  | { id: string; kind: "acquired"; leaseToken: string }
  | { id: string; kind: "expired" }
  | { id: string; kind: "running" }
  | { event: ExtensionQueryEvent; id: string; kind: "terminal" };

export interface ExtensionQueryStore {
  abandon(
    userId: string,
    id: string,
  ): Promise<Extract<ExtensionQueryEvent, { type: "query.failed" }>>;
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
    input: ExtensionQueryRequest;
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
    result: StoreAnalysisResult;
    usage: ModelUsage;
    userId: string;
  }): Promise<Extract<ExtensionQueryEvent, { type: "query.completed" }>>;
  fail(command: {
    billedCalls?: readonly { costMicroUsd: number; usage: ModelUsage }[];
    costMicroUsd?: number;
    error: Extract<ExtensionQueryEvent, { type: "query.failed" }>["error"];
    id: string;
    leaseToken: string;
    priceVersionId?: string;
    reservationId: string;
    usage?: ModelUsage;
    userId: string;
  }): Promise<Extract<ExtensionQueryEvent, { type: "query.failed" }>>;
  find(userId: string, id: string): Promise<ExtensionQueryGeneration | null>;
  markDispatched(command: {
    dispatchedAt?: Date;
    id: string;
    leaseToken: string;
    pricing?: DeepSeekPriceSnapshot;
    userId: string;
  }): Promise<void>;
  terminalizeWithoutReservation(command: {
    error: Extract<ExtensionQueryEvent, { type: "query.failed" }>["error"];
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
