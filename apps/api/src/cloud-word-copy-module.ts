import { createHash } from "node:crypto";

import {
  cloudWordCopyBatchRequestSchema,
  cloudWordCopyBatchResponseSchema,
  cloudWordCopyRequestSchema,
  cloudWordCopyResponseSchema,
  normalizeHeadword,
  type CloudWordCopyBatchRequest,
  type CloudWordCopyBatchResponse,
  type CloudWordCopyResponse,
} from "@huayi/cloud-contracts";

export interface PreparedCloudWordContext {
  collectedAt: string;
  contentHash: string;
  contextId: string;
  contextKey: string;
  contextualMeaningZh?: string;
  sentence: string;
  sourceType: "extension-collection" | "extension-local-import";
}

export interface PreparedCloudWordEntry {
  canonicalKey: string;
  contexts: PreparedCloudWordContext[];
  entryKey: string;
  headword: string;
  wordId: string;
}

interface WriteCommand {
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
}

export interface CloudWordCopyRepository {
  copy(command: WriteCommand & { entry: PreparedCloudWordEntry }): Promise<CloudWordCopyResponse>;
  importBatch(
    command: WriteCommand & {
      entries: readonly PreparedCloudWordEntry[];
    },
  ): Promise<CloudWordCopyBatchResponse>;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createCloudWordCopyModule(options: {
  ids(): string;
  now(): Date;
  repository: CloudWordCopyRepository;
}) {
  const prepareContext = (
    input: {
      collectedAt: string;
      contextKey: string;
      contextualMeaningZh?: string;
      sentence: string;
    },
    sourceType: PreparedCloudWordContext["sourceType"],
  ): PreparedCloudWordContext => ({
    collectedAt: input.collectedAt,
    contentHash: hash({
      ...(input.contextualMeaningZh === undefined
        ? {}
        : { contextualMeaningZh: input.contextualMeaningZh }),
      sentence: input.sentence,
      sourceFamily: "extension-local-copy",
    }),
    contextId: options.ids(),
    contextKey: input.contextKey,
    ...(input.contextualMeaningZh === undefined
      ? {}
      : { contextualMeaningZh: input.contextualMeaningZh }),
    sentence: input.sentence,
    sourceType,
  });
  return {
    async copy(ownerUserId: string, idempotencyKey: string, input: unknown) {
      const request = cloudWordCopyRequestSchema.parse(input);
      return cloudWordCopyResponseSchema.parse(
        await options.repository.copy({
          entry: {
            canonicalKey: normalizeHeadword(request.headword),
            contexts: [
              prepareContext(
                { ...request, contextKey: "single-extension-collection" },
                "extension-collection",
              ),
            ],
            entryKey: "single-extension-collection",
            headword: request.headword,
            wordId: options.ids(),
          },
          idempotencyKey,
          now: options.now().toISOString(),
          ownerUserId,
          requestHash: hash(request),
        }),
      );
    },
    async importLocal(ownerUserId: string, idempotencyKey: string, input: unknown) {
      const request: CloudWordCopyBatchRequest = cloudWordCopyBatchRequestSchema.parse(input);
      return cloudWordCopyBatchResponseSchema.parse(
        await options.repository.importBatch({
          entries: request.entries.map((entry) => ({
            canonicalKey: normalizeHeadword(entry.headword),
            contexts: entry.contexts.map((context) =>
              prepareContext(
                {
                  collectedAt: context.collectedAt,
                  contextKey: context.contextKey,
                  ...(context.contextualMeaningZh === undefined
                    ? {}
                    : { contextualMeaningZh: context.contextualMeaningZh }),
                  sentence: context.sentence,
                },
                "extension-local-import",
              ),
            ),
            entryKey: entry.entryKey,
            headword: entry.headword,
            wordId: options.ids(),
          })),
          idempotencyKey,
          now: options.now().toISOString(),
          ownerUserId,
          requestHash: hash(request),
        }),
      );
    },
  };
}

export type CloudWordCopyModule = ReturnType<typeof createCloudWordCopyModule>;
