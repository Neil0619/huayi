import type { AnalysisEvent, AnalysisRequestStatus } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { AnalysisRequestLifecycle } from "./analysis-ports.js";

interface RequestState {
  event?: AnalysisEvent;
  idempotencyKey: string;
  leaseExpiresAt: Date;
  leaseToken: string;
  requestHash: string;
  requestId: string;
  recoveryLedgerId: string;
  reservationId?: string;
  unitCount: number;
  state: "running" | "completed" | "failed";
  userId: string;
}

export function createInMemoryAnalysisRequestLifecycle(options: {
  now: () => Date;
  abandonedEvent?: (requestId: string) => AnalysisEvent;
}): AnalysisRequestLifecycle & {
  complete(requestId: string, leaseToken: string, event: AnalysisEvent): void;
} {
  const requests = new Map<string, RequestState>();
  const keys = new Map<string, string>();

  return {
    async attachReservation(command) {
      const request = requests.get(command.requestId);
      if (
        request === undefined ||
        request.userId !== command.userId ||
        request.leaseToken !== command.leaseToken ||
        request.state !== "running"
      ) {
        throw new CloudFault("idempotency_conflict", "The analysis lease is no longer active.");
      }
      request.reservationId = command.reservationId;
    },
    async begin(command) {
      const key = `${command.userId}:${command.idempotencyKey}`;
      const existingId = keys.get(key);
      const existing = existingId === undefined ? undefined : requests.get(existingId);
      if (existing !== undefined) {
        if (existing.requestHash !== command.requestHash) {
          throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
        }
        if (existing.state !== "running" && existing.event !== undefined) {
          return {
            event: structuredClone(existing.event),
            kind: "terminal",
            requestId: existing.requestId,
          };
        }
        if (existing.leaseExpiresAt <= options.now()) {
          existing.state = "failed";
          const abandoned = options.abandonedEvent?.(existing.requestId);
          if (abandoned === undefined) {
            throw new CloudFault(
              "model_unavailable",
              "The previous analysis expired and requires recovery.",
            );
          }
          existing.event = abandoned;
          return {
            event: structuredClone(existing.event),
            kind: "terminal",
            requestId: existing.requestId,
          };
        }
        return {
          kind: "running",
          requestId: existing.requestId,
          unitCount: existing.unitCount,
        };
      }
      requests.set(command.requestId, { ...command, state: "running" });
      keys.set(key, command.requestId);
      return { kind: "acquired", leaseToken: command.leaseToken, requestId: command.requestId };
    },
    async beginCapture(command) {
      return this.begin(command);
    },
    complete(requestId, leaseToken, event) {
      const request = requests.get(requestId);
      if (
        request === undefined ||
        request.leaseToken !== leaseToken ||
        request.state !== "running"
      ) {
        throw new CloudFault("idempotency_conflict", "The analysis lease is no longer active.");
      }
      request.event = structuredClone(event);
      request.state = event.type === "analysis.completed" ? "completed" : "failed";
    },
    async get(userId, requestId): Promise<AnalysisRequestStatus | null> {
      const request = requests.get(requestId);
      if (request === undefined || request.userId !== userId) return null;
      if (request.state === "running") return { requestId, state: "running" };
      if (request.event?.type === "analysis.completed") {
        return { analysisId: request.event.analysis.id, requestId, state: "completed" };
      }
      if (request.event?.type === "analysis.failed") {
        return { error: request.event.error, requestId, state: "failed" };
      }
      return null;
    },
    async terminalizeWithoutReservation(command) {
      this.complete(command.requestId, command.leaseToken, {
        error: command.error,
        quota: command.quota,
        type: "analysis.failed",
      });
    },
  };
}
