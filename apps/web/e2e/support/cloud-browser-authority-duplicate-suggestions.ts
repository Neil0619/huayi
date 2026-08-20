import type { Request, Route } from "@playwright/test";
import {
  duplicateSuggestionsHeadersSchema,
  duplicateSuggestionsRequestSchema,
  duplicateSuggestionsResponseSchema,
  learningItemDetailResponseSchema,
  learningItemMergeResponseSchema,
  mergeLearningItemsRequestSchema,
  mergePreviewResponseSchema,
  type ApiError,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";

import { createCloudBrowserManualLearningItem } from "./cloud-browser-authority-learning.js";
import { cloudRequestBody } from "./cloud-browser-authority-request.js";
import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

interface DuplicateSuggestionAuthorityDependencies {
  items(): LearningItemDetailResponse[];
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
  replaceItems(items: LearningItemDetailResponse[]): void;
  replay(path: string, key: string, hash: string): unknown | "conflict" | undefined;
  saveReplay(path: string, key: string, hash: string, response: unknown): void;
  webMutationProof(request: Request, revision?: number): boolean;
  webProof(request: Request, revision?: number): string | null;
}

export function createCloudBrowserDuplicateSuggestionAuthority(active: boolean, now: string) {
  let providerCallCount = 0;

  const seedItems = (): LearningItemDetailResponse[] =>
    active
      ? [
          createCloudBrowserManualLearningItem(
            {
              content: {
                meaningZh: "坦率地说",
                text: "frankly speaking",
                type: "expression",
                usageZh: "直接表达意见。",
              },
              systemAttributes: ["spoken"],
              tags: ["Source"],
            },
            now,
            "item-source",
          ),
          createCloudBrowserManualLearningItem(
            {
              content: {
                meaningZh: "坦率地说",
                text: "to be frank",
                type: "expression",
                usageZh: "用于坦率说明观点。",
              },
              systemAttributes: ["spoken"],
              tags: ["Target"],
            },
            now,
            "item-target",
          ),
        ]
      : [];

  const mergeContext = (items: LearningItemDetailResponse[], sourceId: string, body: unknown) => {
    const parsed = mergeLearningItemsRequestSchema.safeParse(body);
    if (!parsed.success) return null;
    const source = items.find((candidate) => candidate.item.id === sourceId);
    const target = items.find((candidate) => candidate.item.id === parsed.data.targetItemId);
    if (
      source === undefined ||
      target === undefined ||
      source.item.revision !== parsed.data.sourceRevision ||
      target.item.revision !== parsed.data.targetRevision ||
      source.item.type !== target.item.type ||
      source.archivedAt !== null ||
      target.archivedAt !== null
    ) {
      return null;
    }
    return { request: parsed.data, source, target };
  };

  const suggestions = async (
    route: Route,
    id: string,
    dependencies: DuplicateSuggestionAuthorityDependencies,
  ) => {
    const request = route.request();
    const source = dependencies.items().find((candidate) => candidate.item.id === id);
    if (source === undefined) return dependencies.reject(route, 404, "not_found");
    const parsed = duplicateSuggestionsRequestSchema.safeParse(cloudRequestBody(request));
    const headers = request.headers();
    const parsedHeaders = duplicateSuggestionsHeadersSchema.safeParse({
      "idempotency-key": headers["idempotency-key"],
      ...(headers["if-match"] === undefined ? {} : { "if-match": headers["if-match"] }),
    });
    const key = dependencies.webProof(request);
    if (!parsed.success || !parsedHeaders.success) {
      return dependencies.reject(route, 400, "invalid_request");
    }
    if (key === null) return dependencies.reject(route, 403, "forbidden");
    const path = new URL(request.url()).pathname;
    const hash = JSON.stringify(parsed.data);
    const prior = dependencies.replay(path, key, hash);
    if (prior === "conflict") {
      return dependencies.reject(route, 409, "idempotency_conflict", "write-valid");
    }
    if (prior !== undefined) {
      dependencies.record(request, "write-valid");
      await dependencies.json(route, 200, prior);
      return;
    }
    if (source.item.revision !== parsed.data.expectedRevision || source.archivedAt !== null) {
      return dependencies.reject(route, 409, "revision_conflict", "write-valid");
    }
    const candidate = dependencies
      .items()
      .find(
        (item) =>
          item.item.id !== source.item.id &&
          item.item.type === source.item.type &&
          item.archivedAt === null,
      );
    const response = duplicateSuggestionsResponseSchema.parse({
      itemRevision: source.item.revision,
      suggestions:
        candidate === undefined ? [] : [{ candidate, confidence: 0.8, reasonZh: "语义用途接近。" }],
    });
    providerCallCount += candidate === undefined ? 0 : 1;
    dependencies.saveReplay(path, key, hash, response);
    dependencies.record(request, "write-valid");
    await dependencies.json(route, 200, response);
  };

  const preview = async (
    route: Route,
    sourceId: string,
    dependencies: DuplicateSuggestionAuthorityDependencies,
  ) => {
    const request = route.request();
    const context = mergeContext(dependencies.items(), sourceId, cloudRequestBody(request));
    if (!dependencies.webMutationProof(request)) {
      return dependencies.reject(route, 403, "forbidden");
    }
    if (context === null) {
      return dependencies.reject(route, 409, "revision_conflict", "write-valid");
    }
    const allowed =
      !context.source.hasPracticeHistory &&
      context.source.schedule.level === -1 &&
      context.source.recentPractice === null;
    const response = mergePreviewResponseSchema.parse({
      allowed,
      blockedReason: allowed
        ? null
        : context.source.hasPracticeHistory || context.source.recentPractice !== null
          ? "source_has_practice_history"
          : "source_is_scheduled",
      scheduleDecision: "keep-target",
      source: context.source,
      target: context.target,
    });
    dependencies.record(request, "write-valid");
    await dependencies.json(route, 200, response);
  };

  const confirm = async (
    route: Route,
    sourceId: string,
    dependencies: DuplicateSuggestionAuthorityDependencies,
  ) => {
    const request = route.request();
    const context = mergeContext(dependencies.items(), sourceId, cloudRequestBody(request));
    if (context === null) return dependencies.reject(route, 409, "revision_conflict");
    const key = dependencies.webProof(request, context.request.sourceRevision);
    if (key === null) return dependencies.reject(route, 403, "forbidden");
    const path = new URL(request.url()).pathname;
    const hash = JSON.stringify(context.request);
    const prior = dependencies.replay(path, key, hash);
    if (prior === "conflict") {
      return dependencies.reject(route, 409, "idempotency_conflict", "write-valid");
    }
    if (prior !== undefined) {
      dependencies.record(request, "write-valid");
      await dependencies.json(route, 200, prior);
      return;
    }
    if (
      context.source.hasPracticeHistory ||
      context.source.schedule.level !== -1 ||
      context.source.recentPractice !== null
    ) {
      return dependencies.reject(route, 409, "learning_item_in_use", "write-valid");
    }
    const target = learningItemDetailResponseSchema.parse({
      ...context.target,
      item: {
        ...context.target.item,
        revision: context.target.item.revision + 1,
        updatedAt: now,
      },
    });
    dependencies.replaceItems(
      dependencies
        .items()
        .filter((candidate) => candidate.item.id !== context.source.item.id)
        .map((candidate) => (candidate.item.id === target.item.id ? target : candidate)),
    );
    const response = learningItemMergeResponseSchema.parse({
      deletedSourceId: context.source.item.id,
      target,
    });
    dependencies.saveReplay(path, key, hash, response);
    dependencies.record(request, "write-valid");
    await dependencies.json(route, 200, response);
  };

  return {
    async handle(route: Route, dependencies: DuplicateSuggestionAuthorityDependencies) {
      if (!active) return false;
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const suggestionMatch = /^\/v1\/learning-items\/([^/]+)\/duplicate-suggestions$/u.exec(
        pathname,
      );
      if (suggestionMatch?.[1] !== undefined && request.method() === "POST") {
        await suggestions(route, decodeURIComponent(suggestionMatch[1]), dependencies);
        return true;
      }
      const previewMatch = /^\/v1\/learning-items\/([^/]+)\/merge:preview$/u.exec(pathname);
      if (previewMatch?.[1] !== undefined && request.method() === "POST") {
        await preview(route, decodeURIComponent(previewMatch[1]), dependencies);
        return true;
      }
      const confirmMatch = /^\/v1\/learning-items\/([^/]+)\/merge:confirm$/u.exec(pathname);
      if (confirmMatch?.[1] !== undefined && request.method() === "POST") {
        await confirm(route, decodeURIComponent(confirmMatch[1]), dependencies);
        return true;
      }
      return false;
    },
    providerCallCount: () => providerCallCount,
    seedItems,
  };
}
