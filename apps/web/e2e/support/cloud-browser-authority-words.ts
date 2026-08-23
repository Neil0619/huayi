import type { Request, Route } from "@playwright/test";
import {
  cloudWordCopyBatchRequestSchema,
  cloudWordCopyBatchResponseSchema,
  cloudWordCopyRequestSchema,
  cloudWordCopyResponseSchema,
  idempotencyKeySchema,
  listWordEntriesQuerySchema,
  normalizeHeadword,
  upsertWordRequestSchema,
  upsertWordResponseSchema,
  wordEntryDetailQuerySchema,
  wordEntryDetailResponseSchema,
  wordEntryListResponseSchema,
  type ApiError,
} from "@huayi/cloud-contracts";

import {
  cloudQueryObject,
  cloudRequestBody,
  type CloudStoredReplay,
} from "./cloud-browser-authority-request.js";
import type {
  CloudBrowserAuthenticatedAs,
  CloudBrowserRequestFact,
} from "./cloud-browser-authority-types.js";

interface WordAuthorityContext {
  authentication(request: Request): CloudBrowserAuthenticatedAs;
  json(route: Route, status: number, body: unknown): Promise<void>;
  mutationProof(request: Request): boolean;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
  writeProof(request: Request): string | null;
}

type StoredWord = ReturnType<typeof wordEntryDetailResponseSchema.parse>;

function extensionWriteIsValid(request: Request, context: WordAuthorityContext): boolean {
  return (
    context.authentication(request) === "extension" &&
    request.headers()["x-huayi-client-version"] === "1.0.0" &&
    idempotencyKeySchema.safeParse(request.headers()["idempotency-key"]).success
  );
}

export function createCloudBrowserWordAuthority() {
  const contextKeys = new Map<string, Set<string>>();
  const replays = new Map<string, CloudStoredReplay>();
  const words = new Map<string, StoredWord>();
  let copyCount = 0;
  let importCount = 0;
  let nextWordSequence = 0;

  const createWord = (headword: string, at: string): StoredWord => {
    const canonicalKey = normalizeHeadword(headword);
    return wordEntryDetailResponseSchema.parse({
      contexts: { items: [], nextCursor: null },
      word: {
        canonicalKey,
        createdAt: at,
        headword,
        id: `word-${++nextWordSequence}`,
        revision: 1,
        updatedAt: at,
      },
    });
  };

  return {
    copyCount: () => copyCount,
    count: () => words.size,
    exportEntries: () =>
      [...words.values()].map((item) => {
        const contextLine = item.contexts.items.at(-1)?.sourceText;
        return contextLine === undefined
          ? { headword: item.word.headword }
          : { contextLine, headword: item.word.headword };
      }),
    importEudic(entries: readonly { addedAt: string; contextLine?: string; headword: string }[]) {
      for (const entry of entries) {
        const canonicalKey = normalizeHeadword(entry.headword);
        let word = words.get(canonicalKey) ?? createWord(entry.headword, entry.addedAt);
        if (entry.contextLine !== undefined) {
          word = wordEntryDetailResponseSchema.parse({
            contexts: {
              items: [
                ...word.contexts.items,
                {
                  id: `${word.word.id}-context-${word.contexts.items.length + 1}`,
                  observedAt: entry.addedAt,
                  sourceText: entry.contextLine,
                  sourceType: "eudic",
                },
              ],
              nextCursor: null,
            },
            word: {
              ...word.word,
              revision: word.word.revision + 1,
              updatedAt: entry.addedAt,
            },
          });
        }
        words.set(canonicalKey, word);
      }
    },
    importCount: () => importCount,
    async handle(route: Route, context: WordAuthorityContext): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/v1/words:copy" && request.method() === "POST") {
        const parsed = cloudWordCopyRequestSchema.safeParse(cloudRequestBody(request));
        if (!extensionWriteIsValid(request, context) || !parsed.success) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        copyCount += 1;
        const canonicalKey = normalizeHeadword(parsed.data.headword);
        const word =
          words.get(canonicalKey) ?? createWord(parsed.data.headword, parsed.data.collectedAt);
        const contextCreated = word.contexts.items.every(
          (item) =>
            item.sourceText !== parsed.data.sentence ||
            item.contextualMeaningZh !== parsed.data.contextualMeaningZh,
        );
        const next = contextCreated
          ? wordEntryDetailResponseSchema.parse({
              contexts: {
                items: [
                  ...word.contexts.items,
                  {
                    contextualMeaningZh: parsed.data.contextualMeaningZh,
                    id: `${word.word.id}-context-${word.contexts.items.length + 1}`,
                    observedAt: parsed.data.collectedAt,
                    sourceText: parsed.data.sentence,
                    sourceType: "extension-collection",
                  },
                ],
                nextCursor: null,
              },
              word: {
                ...word.word,
                revision: word.word.revision + 1,
                updatedAt: parsed.data.collectedAt,
              },
            })
          : word;
        words.set(canonicalKey, next);
        context.record(request, "write-valid");
        await context.json(
          route,
          200,
          cloudWordCopyResponseSchema.parse({ contextCreated, wordId: next.word.id }),
        );
        return true;
      }
      if (url.pathname === "/v1/words:import-local" && request.method() === "POST") {
        const parsed = cloudWordCopyBatchRequestSchema.safeParse(cloudRequestBody(request));
        if (!extensionWriteIsValid(request, context) || !parsed.success) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        importCount += 1;
        const entries = parsed.data.entries.map((entry) => {
          const canonicalKey = normalizeHeadword(entry.headword);
          const existing = words.get(canonicalKey);
          let word =
            existing ??
            createWord(
              entry.headword,
              entry.contexts[0]?.collectedAt ?? "2026-08-13T10:00:00.000Z",
            );
          const knownContextKeys = contextKeys.get(canonicalKey) ?? new Set<string>();
          const outcomes = entry.contexts.map((item) => {
            if (knownContextKeys.has(item.contextKey)) {
              return { contextKey: item.contextKey, outcome: "duplicate" as const };
            }
            knownContextKeys.add(item.contextKey);
            word = wordEntryDetailResponseSchema.parse({
              contexts: {
                items: [
                  ...word.contexts.items,
                  {
                    ...(item.contextualMeaningZh === undefined
                      ? {}
                      : { contextualMeaningZh: item.contextualMeaningZh }),
                    id: `${word.word.id}-context-${word.contexts.items.length + 1}`,
                    observedAt: item.collectedAt,
                    sourceText: item.sentence,
                    sourceType: "extension-collection",
                  },
                ],
                nextCursor: null,
              },
              word: {
                ...word.word,
                revision: word.word.revision + 1,
                updatedAt: item.collectedAt,
              },
            });
            return { contextKey: item.contextKey, outcome: "created" as const };
          });
          contextKeys.set(canonicalKey, knownContextKeys);
          words.set(canonicalKey, word);
          return {
            contexts: outcomes,
            entryKey: entry.entryKey,
            wordId: word.word.id,
            wordOutcome: existing === undefined ? ("created" as const) : ("existing" as const),
          };
        });
        const contexts = entries.flatMap((entry) => entry.contexts);
        context.record(request, "write-valid");
        await context.json(
          route,
          200,
          cloudWordCopyBatchResponseSchema.parse({
            entries,
            summary: {
              contextCount: contexts.length,
              createdContextCount: contexts.filter((item) => item.outcome === "created").length,
              createdWordCount: entries.filter((item) => item.wordOutcome === "created").length,
              duplicateContextCount: contexts.filter((item) => item.outcome === "duplicate").length,
              existingWordCount: entries.filter((item) => item.wordOutcome === "existing").length,
              wordCount: entries.length,
            },
          }),
        );
        return true;
      }
      if (url.pathname === "/v1/words" && request.method() === "GET") {
        const query = listWordEntriesQuerySchema.safeParse(cloudQueryObject(url));
        if (context.authentication(request) !== "web") {
          await context.reject(route, 401, "authentication_required", "read");
          return true;
        }
        if (!query.success) {
          await context.reject(route, 400, "invalid_request", "read");
          return true;
        }
        context.record(request, "read");
        await context.json(
          route,
          200,
          wordEntryListResponseSchema.parse({
            items: [...words.values()].slice(0, query.data.limit).map((item) => item.word),
            nextCursor: null,
          }),
        );
        return true;
      }
      if (url.pathname === "/v1/words" && request.method() === "POST") {
        if (context.authentication(request) !== "web") {
          await context.reject(route, 401, "authentication_required", "write-invalid");
          return true;
        }
        if (!context.mutationProof(request)) {
          await context.reject(route, 403, "forbidden", "write-invalid");
          return true;
        }
        const parsed = upsertWordRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success) {
          await context.reject(route, 400, "invalid_request", "write-invalid");
          return true;
        }
        const key = context.writeProof(request);
        if (key === null) {
          await context.reject(route, 400, "invalid_request", "write-invalid");
          return true;
        }
        const replayKey = `${url.pathname}\u0000${key}`;
        const requestHash = JSON.stringify(parsed.data);
        const prior = replays.get(replayKey);
        if (prior !== undefined) {
          if (prior.hash !== requestHash) {
            await context.reject(route, 409, "idempotency_conflict", "write-valid");
            return true;
          }
          context.record(request, "write-valid");
          await context.json(route, 200, structuredClone(prior.response));
          return true;
        }
        const at = "2026-08-13T10:00:00.000Z";
        const canonicalKey = normalizeHeadword(parsed.data.headword);
        const existing = words.get(canonicalKey);
        let word = existing ?? createWord(parsed.data.headword, at);
        if (existing === undefined && parsed.data.notes !== undefined) {
          word = wordEntryDetailResponseSchema.parse({
            ...word,
            word: { ...word.word, notes: parsed.data.notes },
          });
        }
        let contextOutcome = "omitted" as "created" | "duplicate" | "omitted";
        const manualContext = parsed.data.context;
        if (manualContext !== undefined) {
          const duplicate = word.contexts.items.some(
            (item) =>
              item.sourceText === manualContext.sourceText &&
              item.contextualMeaningZh === manualContext.contextualMeaningZh &&
              item.sourceTitle === manualContext.sourceTitle,
          );
          contextOutcome = duplicate ? "duplicate" : "created";
          if (!duplicate) {
            word = wordEntryDetailResponseSchema.parse({
              contexts: {
                items: [
                  ...word.contexts.items,
                  {
                    id: `${word.word.id}-context-${word.contexts.items.length + 1}`,
                    observedAt: at,
                    sourceType: "manual",
                    ...manualContext,
                  },
                ],
                nextCursor: null,
              },
              word: {
                ...word.word,
                revision: existing === undefined ? word.word.revision : word.word.revision + 1,
                updatedAt: at,
              },
            });
          }
        }
        words.set(canonicalKey, word);
        context.record(request, "write-valid");
        const response = upsertWordResponseSchema.parse({
          contextOutcome,
          word: word.word,
          wordOutcome: existing === undefined ? "created" : "existing",
        });
        replays.set(replayKey, { hash: requestHash, response: structuredClone(response) });
        await context.json(route, 200, response);
        return true;
      }
      if (url.pathname.startsWith("/v1/words/") && request.method() === "GET") {
        const wordId = url.pathname.slice("/v1/words/".length);
        const word = [...words.values()].find((candidate) => candidate.word.id === wordId) ?? null;
        if (
          context.authentication(request) !== "web" ||
          !wordEntryDetailQuerySchema.safeParse(cloudQueryObject(url)).success
        ) {
          await context.reject(route, 403, "forbidden", "read");
          return true;
        }
        context.record(request, "read");
        await context.json(route, word === null ? 404 : 200, word ?? {});
        return true;
      }
      return false;
    },
  };
}
