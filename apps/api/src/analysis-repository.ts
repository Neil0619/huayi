import {
  canonicalKeyForContent,
  confirmCandidatesResponseSchema,
  type AnalysisDeleteResponse,
  type AnalysisEvent,
  type AnalysisRecord,
  type ConfirmCandidatesResponse,
} from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type {
  AnalysisCommitter,
  AnalysisHistoryMutation,
  AnalysisQuota,
  AnalysisRepository,
} from "./analysis-ports.js";

export function createInMemoryAnalysisRepository(): AnalysisRepository & {
  remove(userId: string, id: string): void;
} {
  const records = new Map<string, AnalysisRecord>();
  type LearningItem = Extract<
    ConfirmCandidatesResponse["results"][number],
    { type: "learning-item" }
  >["item"];
  const learningItems = new Map<string, LearningItem>();
  const mutations = new Map<
    string,
    { hash: string; response: AnalysisDeleteResponse | AnalysisRecord | ConfirmCandidatesResponse }
  >();

  function mutate(
    operation: string,
    command: AnalysisHistoryMutation,
    change: (record: AnalysisRecord) => AnalysisDeleteResponse | AnalysisRecord,
  ) {
    const mutationKey = `${command.userId}:${operation}:${command.idempotencyKey}`;
    const previous = mutations.get(mutationKey);
    if (previous !== undefined) {
      if (previous.hash !== command.requestHash) {
        throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
      }
      return structuredClone(previous.response);
    }
    const key = `${command.userId}:${command.id}`;
    const record = records.get(key);
    if (record === undefined) throw new CloudFault("not_found", "Analysis not found.");
    if (record.revision !== command.expectedRevision) {
      throw new CloudFault("revision_conflict", "The analysis revision has changed.");
    }
    const response = change(structuredClone(record));
    if ("deleted" in response) records.delete(key);
    else records.set(key, structuredClone(response));
    mutations.set(mutationKey, { hash: command.requestHash, response: structuredClone(response) });
    return response;
  }

  return {
    async archive(command) {
      return mutate("analysis.archive", command, (record) => ({
        ...record,
        archivedAt: command.updatedAt,
        revision: record.revision + 1,
        updatedAt: command.updatedAt,
      })) as AnalysisRecord;
    },
    async confirmCandidates(command) {
      const mutationKey = `${command.userId}:analysis.confirm:${command.idempotencyKey}`;
      const previous = mutations.get(mutationKey);
      if (previous !== undefined) {
        if (previous.hash !== command.requestHash) {
          throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
        }
        return confirmCandidatesResponseSchema.parse(structuredClone(previous.response));
      }
      const recordKey = `${command.userId}:${command.analysisId}`;
      const analysis = records.get(recordKey);
      if (analysis === undefined) throw new CloudFault("not_found", "Analysis not found.");
      if (
        analysis.revision !== command.expectedRevision ||
        analysis.reviewState !== "pendingReview"
      ) {
        throw new CloudFault("revision_conflict", "The analysis revision has changed.");
      }
      const stagedLearning = new Map(learningItems);
      const ownerPrefix = `${command.userId}:`;
      const results = command.entries.map((entry) => {
        const exact = [...stagedLearning.entries()].find(
          ([key, item]) =>
            key.startsWith(ownerPrefix) &&
            item.type === entry.type &&
            item.canonicalKey === entry.canonicalKey,
        );
        if (entry.action === "created" && exact !== undefined) {
          throw new CloudFault("exact_duplicate", "An exact learning item already exists.");
        }
        const target =
          entry.action === "merged"
            ? stagedLearning.get(`${command.userId}:${entry.targetId}`)
            : undefined;
        if (
          entry.action === "merged" &&
          (target === undefined ||
            target.type !== entry.type ||
            target.canonicalKey !== entry.canonicalKey)
        ) {
          throw new CloudFault("invalid_request", "The learning item merge target is invalid.");
        }
        const sourceExample = { id: entry.sourceExampleId, ...entry.source };
        const item: LearningItem =
          target === undefined
            ? {
                canonicalKey: canonicalKeyForContent(entry.content),
                content: entry.content,
                createdAt: command.updatedAt,
                id: entry.targetId,
                revision: 1,
                sourceExamples: [sourceExample],
                systemAttributes: entry.systemAttributes,
                tags: entry.tags.map((tag) => tag.displayName),
                type: entry.type,
                updatedAt: command.updatedAt,
              }
            : {
                ...target,
                sourceExamples: [...target.sourceExamples, sourceExample],
                systemAttributes: [
                  ...new Set([...target.systemAttributes, ...entry.systemAttributes]),
                ],
                tags: [...new Set([...target.tags, ...entry.tags.map((tag) => tag.displayName)])],
                revision: target.revision + 1,
                updatedAt: command.updatedAt,
              };
        stagedLearning.set(`${command.userId}:${item.id}`, item);
        return {
          action: entry.action,
          candidateId: entry.candidateId,
          item,
          type: "learning-item" as const,
        };
      });
      const updated = {
        ...analysis,
        reviewState: "reviewed" as const,
        revision: analysis.revision + 1,
        updatedAt: command.updatedAt,
      };
      const response = confirmCandidatesResponseSchema.parse({ analysis: updated, results });
      records.set(recordKey, updated);
      for (const [key, value] of stagedLearning) {
        if (key.startsWith(ownerPrefix)) learningItems.set(key, value);
      }
      mutations.set(mutationKey, {
        hash: command.requestHash,
        response: structuredClone(response),
      });
      return response;
    },
    async delete(command) {
      return mutate("analysis.delete", command, () => ({
        deleted: true,
        id: command.id,
      })) as AnalysisDeleteResponse;
    },
    async findById(userId, id) {
      const record = records.get(`${userId}:${id}`);
      return record === undefined ? null : structuredClone(record);
    },
    async list(userId, query) {
      const matching = [...records.entries()]
        .filter(
          ([key, record]) =>
            key.startsWith(`${userId}:`) &&
            (record.archivedAt !== null) === query.archived &&
            (query.reviewState === undefined || record.reviewState === query.reviewState) &&
            (query.sourceType === undefined || record.source.type === query.sourceType) &&
            (query.selectionKind === undefined || record.selectionKind === query.selectionKind) &&
            (query.query === undefined ||
              `${record.sourceText}\n${record.source.title ?? ""}`
                .toLocaleLowerCase("en-US")
                .includes(query.query.toLocaleLowerCase("en-US"))) &&
            (query.boundary === undefined ||
              record.createdAt < query.boundary.createdAt ||
              (record.createdAt === query.boundary.createdAt && record.id < query.boundary.id)),
        )
        .map(([, record]) => structuredClone(record))
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        );
      return { hasMore: matching.length > query.limit, items: matching.slice(0, query.limit) };
    },
    async processNothingToSave(command) {
      return mutate("analysis.process", command, (record) => ({
        ...record,
        reviewState: "reviewed",
        revision: record.revision + 1,
        updatedAt: command.updatedAt,
      })) as AnalysisRecord;
    },
    async replayCandidateConfirmation(command) {
      const mutationKey = `${command.userId}:analysis.confirm:${command.idempotencyKey}`;
      const previous = mutations.get(mutationKey);
      if (previous === undefined) return null;
      if (previous.hash !== command.requestHash) {
        throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
      }
      return confirmCandidatesResponseSchema.parse(structuredClone(previous.response));
    },
    async save(userId, record) {
      const copy = structuredClone(record);
      records.set(`${userId}:${record.id}`, copy);
      return structuredClone(copy);
    },
    remove(userId, id) {
      records.delete(`${userId}:${id}`);
    },
    async restore(command) {
      return mutate("analysis.restore", command, (record) => ({
        ...record,
        archivedAt: null,
        revision: record.revision + 1,
        updatedAt: command.updatedAt,
      })) as AnalysisRecord;
    },
  };
}

export function createInMemoryAnalysisCommitter(
  repository: AnalysisRepository & { remove(userId: string, id: string): void },
  quota: AnalysisQuota,
  lifecycle: { complete(requestId: string, leaseToken: string, event: AnalysisEvent): void },
): AnalysisCommitter {
  return {
    async complete(command) {
      const record = await repository.save(command.userId, command.record);
      try {
        await quota.settle({
          ...(command.actualCostMicroUsd === undefined
            ? {}
            : { actualCostMicroUsd: command.actualCostMicroUsd }),
          ...(command.billedCalls === undefined ? {} : { billedCalls: command.billedCalls }),
          outcome: "succeeded",
          requestId: command.requestId,
          reservationId: command.reservationId,
          ...(command.usage === undefined ? {} : { usage: command.usage }),
        });
        const summary = await quota.summary(command.userId);
        lifecycle.complete(command.requestId, command.leaseToken, {
          analysis: record,
          quota: summary,
          type: "analysis.completed",
        });
        return { quota: summary, record };
      } catch (error) {
        repository.remove(command.userId, command.record.id);
        throw error;
      }
    },
    async fail(command) {
      await quota.settle({
        ...(command.actualCostMicroUsd === undefined
          ? {}
          : { actualCostMicroUsd: command.actualCostMicroUsd }),
        ...(command.billedCalls === undefined ? {} : { billedCalls: command.billedCalls }),
        outcome: "failed",
        requestId: command.requestId,
        reservationId: command.reservationId,
        ...(command.usage === undefined ? {} : { usage: command.usage }),
      });
      const event = {
        error: command.error,
        quota: await quota.summary(command.userId),
        type: "analysis.failed" as const,
      };
      lifecycle.complete(command.requestId, command.leaseToken, event);
      return event;
    },
  };
}
