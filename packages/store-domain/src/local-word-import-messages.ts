import { STORE_MESSAGE_VERSION } from "./messages.js";

const MAX_WORD_COUNT = 100_000;
const MAX_CONTEXT_COUNT = 1_000_000;

export type LocalWordImportRequest =
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type:
        | "store/local-word-import-preview"
        | "store/local-word-import-retry"
        | "store/local-word-import-status";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly previewId: string;
      readonly type: "store/local-word-import-confirm";
    };

export type LocalWordImportResponse =
  | {
      readonly contextCount: number;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome: "preview";
      readonly previewId: string;
      readonly type: "store/local-word-import-result";
      readonly wordCount: number;
    }
  | {
      readonly contextCount: number;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome: "progress";
      readonly processedContextCount: number;
      readonly processedWordCount: number;
      readonly type: "store/local-word-import-result";
      readonly wordCount: number;
    }
  | {
      readonly contextCount: number;
      readonly createdContextCount: number;
      readonly createdWordCount: number;
      readonly duplicateContextCount: number;
      readonly existingWordCount: number;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome: "completed";
      readonly type: "store/local-word-import-result";
      readonly wordCount: number;
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome:
        | "client-upgrade-required"
        | "empty"
        | "failed"
        | "not-configured"
        | "retry-pending"
        | "session-unavailable"
        | "snapshot-changed"
        | "upload-disabled";
      readonly type: "store/local-word-import-result";
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function version(value: unknown): typeof STORE_MESSAGE_VERSION {
  if (value !== STORE_MESSAGE_VERSION) throw new TypeError("Local word import version is invalid.");
  return STORE_MESSAGE_VERSION;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError("Local word import preview id is invalid.");
  }
  return value;
}

function count(value: unknown, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError("Local word import count is invalid.");
  }
  return value as number;
}

export function parseLocalWordImportRequest(value: unknown): LocalWordImportRequest {
  if (!record(value)) throw new TypeError("Local word import request is invalid.");
  const messageVersion = version(value.messageVersion);
  if (value.type === "store/local-word-import-confirm") {
    if (!exact(value, ["messageVersion", "previewId", "type"])) {
      throw new TypeError("Local word import request is invalid.");
    }
    return { messageVersion, previewId: id(value.previewId), type: value.type };
  }
  if (
    (value.type !== "store/local-word-import-preview" &&
      value.type !== "store/local-word-import-retry" &&
      value.type !== "store/local-word-import-status") ||
    !exact(value, ["messageVersion", "type"])
  ) {
    throw new TypeError("Local word import request is invalid.");
  }
  return { messageVersion, type: value.type };
}

export function parseLocalWordImportResponse(value: unknown): LocalWordImportResponse {
  if (!record(value) || value.type !== "store/local-word-import-result") {
    throw new TypeError("Local word import response is invalid.");
  }
  const messageVersion = version(value.messageVersion);
  const base = { messageVersion, type: "store/local-word-import-result" as const };
  if (value.outcome === "preview") {
    if (
      !exact(value, ["contextCount", "messageVersion", "outcome", "previewId", "type", "wordCount"])
    ) {
      throw new TypeError("Local word import preview is invalid.");
    }
    return {
      ...base,
      contextCount: count(value.contextCount, MAX_CONTEXT_COUNT),
      outcome: value.outcome,
      previewId: id(value.previewId),
      wordCount: count(value.wordCount, MAX_WORD_COUNT),
    };
  }
  if (value.outcome === "progress") {
    if (
      !exact(value, [
        "contextCount",
        "messageVersion",
        "outcome",
        "processedContextCount",
        "processedWordCount",
        "type",
        "wordCount",
      ])
    ) {
      throw new TypeError("Local word import progress is invalid.");
    }
    const contextCount = count(value.contextCount, MAX_CONTEXT_COUNT);
    const wordCount = count(value.wordCount, MAX_WORD_COUNT);
    const processedContextCount = count(value.processedContextCount, contextCount);
    const processedWordCount = count(value.processedWordCount, wordCount);
    return {
      ...base,
      contextCount,
      outcome: value.outcome,
      processedContextCount,
      processedWordCount,
      wordCount,
    };
  }
  if (value.outcome === "completed") {
    if (
      !exact(value, [
        "contextCount",
        "createdContextCount",
        "createdWordCount",
        "duplicateContextCount",
        "existingWordCount",
        "messageVersion",
        "outcome",
        "type",
        "wordCount",
      ])
    ) {
      throw new TypeError("Local word import completion is invalid.");
    }
    const contextCount = count(value.contextCount, MAX_CONTEXT_COUNT);
    const wordCount = count(value.wordCount, MAX_WORD_COUNT);
    const createdContextCount = count(value.createdContextCount, contextCount);
    const duplicateContextCount = count(value.duplicateContextCount, contextCount);
    const createdWordCount = count(value.createdWordCount, wordCount);
    const existingWordCount = count(value.existingWordCount, wordCount);
    if (
      createdContextCount + duplicateContextCount !== contextCount ||
      createdWordCount + existingWordCount !== wordCount
    ) {
      throw new TypeError("Local word import completion totals are invalid.");
    }
    return {
      ...base,
      contextCount,
      createdContextCount,
      createdWordCount,
      duplicateContextCount,
      existingWordCount,
      outcome: value.outcome,
      wordCount,
    };
  }
  if (
    !exact(value, ["messageVersion", "outcome", "type"]) ||
    (value.outcome !== "client-upgrade-required" &&
      value.outcome !== "empty" &&
      value.outcome !== "failed" &&
      value.outcome !== "not-configured" &&
      value.outcome !== "retry-pending" &&
      value.outcome !== "session-unavailable" &&
      value.outcome !== "snapshot-changed" &&
      value.outcome !== "upload-disabled")
  ) {
    throw new TypeError("Local word import response is invalid.");
  }
  return { ...base, outcome: value.outcome };
}
