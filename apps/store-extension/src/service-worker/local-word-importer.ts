import {
  cloudWordCopyBatchRequestSchema,
  type CloudWordCopyBatchRequest,
  type CloudWordCopyBatchResponse,
} from "@huayi/cloud-contracts";
import {
  STORE_MESSAGE_VERSION,
  parseLocalWordImportResponse,
  type LexiconRepository,
  type LocalWordImportResponse,
  type WordEntry,
} from "@huayi/store-domain";

import { CloudWordCopyError } from "./cloud-word-copy-api.js";
import type { LocalWordImportJob, LocalWordImportVault } from "./local-word-import-vault.js";

const MAX_BATCH_WORDS = 100;
const MAX_BATCH_CONTEXTS = 1_000;

interface LocalWordImportApi {
  importLocal(
    input: CloudWordCopyBatchRequest,
    key: string,
    sessionToken: string,
  ): Promise<CloudWordCopyBatchResponse>;
}

interface SessionVault {
  clearSession(): Promise<void>;
  readSession(): Promise<{ expiresAt: string; token: string } | null>;
}

interface LocalWordImporterOptions {
  readonly allowUpload: () => Promise<boolean>;
  readonly api: LocalWordImportApi | null;
  readonly clientVersion: string;
  readonly createIdempotencyKey: () => string;
  readonly crypto: Crypto;
  readonly lexicon: Pick<LexiconRepository, "snapshot">;
  readonly now: () => Date;
  readonly sessionVault: SessionVault;
  readonly vault: Pick<LocalWordImportVault, "clear" | "read" | "write">;
}

export interface LocalWordImportRunResult {
  readonly pending: boolean;
  readonly response: LocalWordImportResponse;
}

function response(value: Record<string, unknown>) {
  return parseLocalWordImportResponse({
    ...value,
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/local-word-import-result",
  });
}

function importEntry(entry: WordEntry) {
  return {
    contexts: entry.contexts.map((context) => ({
      collectedAt: context.observedAt,
      contextKey: context.id,
      ...(context.source === "eudic-import"
        ? {}
        : { contextualMeaningZh: context.contextualMeaningZh }),
      sentence: context.sentence,
    })),
    entryKey: entry.id,
    headword: entry.headword,
  };
}

function batches(entries: readonly WordEntry[]): CloudWordCopyBatchRequest[] {
  const result: CloudWordCopyBatchRequest[] = [];
  let current: ReturnType<typeof importEntry>[] = [];
  let contextCount = 0;
  for (const source of entries) {
    const entry = importEntry(source);
    if (
      current.length > 0 &&
      (current.length === MAX_BATCH_WORDS ||
        contextCount + entry.contexts.length > MAX_BATCH_CONTEXTS)
    ) {
      result.push(cloudWordCopyBatchRequestSchema.parse({ entries: current }));
      current = [];
      contextCount = 0;
    }
    current.push(entry);
    contextCount += entry.contexts.length;
  }
  if (current.length > 0) {
    result.push(cloudWordCopyBatchRequestSchema.parse({ entries: current }));
  }
  return result;
}

function totals(job: LocalWordImportJob) {
  return {
    contextCount: job.batches.reduce(
      (total, batch) =>
        total + batch.request.entries.reduce((sum, entry) => sum + entry.contexts.length, 0),
      0,
    ),
    wordCount: job.batches.reduce((total, batch) => total + batch.request.entries.length, 0),
  };
}

function addSummary(
  current: LocalWordImportJob["summary"],
  next: CloudWordCopyBatchResponse["summary"],
): LocalWordImportJob["summary"] {
  return {
    contextCount: current.contextCount + next.contextCount,
    createdContextCount: current.createdContextCount + next.createdContextCount,
    createdWordCount: current.createdWordCount + next.createdWordCount,
    duplicateContextCount: current.duplicateContextCount + next.duplicateContextCount,
    existingWordCount: current.existingWordCount + next.existingWordCount,
    wordCount: current.wordCount + next.wordCount,
  };
}

async function previewId(crypto: Crypto, requests: CloudWordCopyBatchRequest[]) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(requests)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createLocalWordImporter(options: LocalWordImporterOptions) {
  const status = async (): Promise<LocalWordImportResponse> => {
    const job = await options.vault.read();
    if (job === null) return response({ outcome: "empty" });
    if (job.status === "completed") return response({ ...job.summary, outcome: "completed" });
    if (job.status === "client-upgrade-required") {
      return response({ outcome: "client-upgrade-required" });
    }
    if (job.status === "failed") return response({ outcome: "failed" });
    const total = totals(job);
    return response({
      ...total,
      outcome: "progress",
      processedContextCount: job.summary.contextCount,
      processedWordCount: job.summary.wordCount,
    });
  };

  const processOne = async (): Promise<LocalWordImportRunResult> => {
    const job = await options.vault.read();
    if (job === null) return { pending: false, response: response({ outcome: "empty" }) };
    if (
      job.status === "client-upgrade-required" &&
      job.clientUpgradeRequiredAtVersion === options.clientVersion
    ) {
      return {
        pending: false,
        response: response({ outcome: "client-upgrade-required" }),
      };
    }
    if (job.status === "completed") {
      return { pending: false, response: response({ ...job.summary, outcome: "completed" }) };
    }
    if (options.api === null) {
      return { pending: false, response: response({ outcome: "not-configured" }) };
    }
    if (!(await options.allowUpload())) {
      await options.vault.clear();
      return { pending: false, response: response({ outcome: "upload-disabled" }) };
    }
    const session = await options.sessionVault.readSession();
    if (session === null || Date.parse(session.expiresAt) <= options.now().getTime()) {
      await Promise.all([options.sessionVault.clearSession(), options.vault.clear()]);
      return { pending: false, response: response({ outcome: "session-unavailable" }) };
    }
    const batch = job.batches[job.nextBatchIndex];
    if (batch === undefined) throw new Error("Local word import progress is invalid.");
    try {
      const imported = await options.api.importLocal(
        batch.request,
        batch.idempotencyKey,
        session.token,
      );
      const nextBatchIndex = job.nextBatchIndex + 1;
      const next: LocalWordImportJob = {
        batches: job.batches,
        nextBatchIndex,
        status: nextBatchIndex === job.batches.length ? "completed" : "pending",
        summary: addSummary(job.summary, imported.summary),
      };
      await options.vault.write(next);
      return {
        pending: next.status !== "completed",
        response:
          next.status === "completed"
            ? response({ ...next.summary, outcome: "completed" })
            : await status(),
      };
    } catch (error) {
      if (error instanceof CloudWordCopyError && error.kind === "authentication") {
        await Promise.all([options.sessionVault.clearSession(), options.vault.clear()]);
        return { pending: false, response: response({ outcome: "session-unavailable" }) };
      }
      const next: LocalWordImportJob = {
        ...job,
        ...(error instanceof CloudWordCopyError && error.kind === "client-upgrade-required"
          ? { clientUpgradeRequiredAtVersion: options.clientVersion }
          : {}),
        status:
          error instanceof CloudWordCopyError && error.kind === "client-upgrade-required"
            ? "client-upgrade-required"
            : error instanceof CloudWordCopyError && error.kind === "transient"
              ? "retry-pending"
              : "failed",
      };
      await options.vault.write(next);
      const failureOutcome =
        next.status === "client-upgrade-required"
          ? "client-upgrade-required"
          : next.status === "retry-pending"
            ? "retry-pending"
            : "failed";
      return {
        pending: next.status === "retry-pending",
        response: response({ outcome: failureOutcome }),
      };
    }
  };

  return {
    async confirm(expectedPreviewId: string): Promise<LocalWordImportRunResult> {
      const snapshot = await options.lexicon.snapshot();
      if (snapshot.length === 0) {
        return { pending: false, response: response({ outcome: "empty" }) };
      }
      const requests = batches(snapshot);
      if ((await previewId(options.crypto, requests)) !== expectedPreviewId) {
        return { pending: false, response: response({ outcome: "snapshot-changed" }) };
      }
      if (options.api === null) {
        return { pending: false, response: response({ outcome: "not-configured" }) };
      }
      if (!(await options.allowUpload())) {
        return { pending: false, response: response({ outcome: "upload-disabled" }) };
      }
      const session = await options.sessionVault.readSession();
      if (session === null || Date.parse(session.expiresAt) <= options.now().getTime()) {
        return { pending: false, response: response({ outcome: "session-unavailable" }) };
      }
      await options.vault.write({
        batches: requests.map((request) => ({
          idempotencyKey: options.createIdempotencyKey(),
          request,
        })),
        nextBatchIndex: 0,
        status: "pending",
        summary: {
          contextCount: 0,
          createdContextCount: 0,
          createdWordCount: 0,
          duplicateContextCount: 0,
          existingWordCount: 0,
          wordCount: 0,
        },
      });
      return processOne();
    },
    processOne,
    async preview(): Promise<LocalWordImportResponse> {
      const requests = batches(await options.lexicon.snapshot());
      if (requests.length === 0) return response({ outcome: "empty" });
      const aggregate = requests.reduce(
        (current, request) => ({
          contextCount:
            current.contextCount +
            request.entries.reduce((total, entry) => total + entry.contexts.length, 0),
          wordCount: current.wordCount + request.entries.length,
        }),
        { contextCount: 0, wordCount: 0 },
      );
      return response({
        ...aggregate,
        outcome: "preview",
        previewId: await previewId(options.crypto, requests),
      });
    },
    status,
  };
}

export type LocalWordImporter = ReturnType<typeof createLocalWordImporter>;
