import type { QuotaSummary } from "@huayi/cloud-contracts";

import type { AnalysisModel, AnalysisQuota } from "../analysis-ports.js";

export class FakeAnalysisModel implements AnalysisModel {
  failure?: Error;
  readonly requests: Parameters<AnalysisModel["analyze"]>[0][] = [];

  constructor(readonly content: unknown) {}

  async analyze(command: Parameters<AnalysisModel["analyze"]>[0]) {
    this.requests.push(structuredClone({ input: command.input, sentences: command.sentences }));
    if (this.failure !== undefined) throw this.failure;
    return {
      content: this.content,
      billedCalls: [
        {
          costMicroUsd: 20_000,
          usage: { cachedInputTokens: 10, inputTokens: 100, outputTokens: 200 },
        },
      ],
      preview: "正在分析。",
      usage: { cachedInputTokens: 10, inputTokens: 100, outputTokens: 200 },
      usageCostMicroUsd: 20_000,
    };
  }
}

export class FakeAnalysisQuota implements AnalysisQuota {
  readonly operations: string[] = [];
  readonly settlements: Parameters<AnalysisQuota["settle"]>[0][] = [];
  #used = 0;
  #reserved = 0;

  async reserve(command: { requestId: string; reservedMicroUsd: number; userId: string }) {
    this.operations.push(`reserve:${command.requestId}`);
    this.#reserved = command.reservedMicroUsd;
    return { id: `reservation:${command.requestId}` };
  }

  settle(command: {
    actualCostMicroUsd?: number;
    outcome: "succeeded" | "failed";
    requestId: string;
    reservationId: string;
    usage?: { cachedInputTokens: number; inputTokens: number; outputTokens: number };
  }): void {
    this.settlements.push(structuredClone(command));
    this.operations.push(`settle:${command.requestId}:${command.outcome}`);
    this.#used += command.actualCostMicroUsd ?? this.#reserved;
    this.#reserved = 0;
  }

  summary(): QuotaSummary {
    const limitMicroUsd = 1_000_000;
    const percentUsed = (this.#used / limitMicroUsd) * 100;
    return {
      availableMicroUsd: limitMicroUsd - this.#used - this.#reserved,
      limitMicroUsd,
      percentUsed,
      periodEnd: "2026-09-01T00:00:00.000Z",
      periodStart: "2026-08-01T00:00:00.000Z",
      reservedMicroUsd: this.#reserved,
      usedMicroUsd: this.#used,
      warning: percentUsed >= 80 ? "warning" : "available",
    };
  }
}
