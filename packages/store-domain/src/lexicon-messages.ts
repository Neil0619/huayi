import { STORE_MESSAGE_VERSION } from "./messages.js";
import {
  MAX_CONTEXT_SENTENCE_LENGTH,
  MAX_HEADWORD_LENGTH,
  normalizeHeadword,
} from "./normalization.js";

export const MAX_LEXICON_CONTEXTUAL_MEANING_LENGTH = 1_000;

export interface StoreLexiconSaveRequest {
  readonly contextualMeaningZh: string;
  readonly headword: string;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly sentence: string;
  readonly type: "store/lexicon-save";
}

export interface StoreLexiconPresenceRequest {
  readonly headword: string;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/lexicon-presence";
}

export type StoreLexiconRequest = StoreLexiconSaveRequest | StoreLexiconPresenceRequest;
export type StoreLexiconErrorCode = "data-corrupt" | "internal-error" | "invalid-request";
export type StoreLexiconResponse =
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly status: "duplicate" | "saved";
      readonly type: "store/lexicon-save-result";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly present: boolean;
      readonly type: "store/lexicon-presence-result";
    }
  | {
      readonly code: StoreLexiconErrorCode;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/lexicon-error";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function parseText(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new TypeError("Store lexicon text is invalid.");
  const parsed = value.trim();
  if (parsed.length === 0 || parsed.length > maximum) {
    throw new TypeError("Store lexicon text is invalid.");
  }
  return parsed;
}

function currentVersion(value: unknown): typeof STORE_MESSAGE_VERSION {
  if (value !== STORE_MESSAGE_VERSION) throw new TypeError("Store lexicon version is invalid.");
  return STORE_MESSAGE_VERSION;
}

export function parseStoreLexiconRequest(value: unknown): StoreLexiconRequest {
  if (!isRecord(value)) throw new TypeError("Store lexicon request is invalid.");
  if (value.type === "store/lexicon-presence") {
    if (!hasExactlyKeys(value, ["headword", "messageVersion", "type"])) {
      throw new TypeError("Store lexicon presence request is invalid.");
    }
    return {
      headword: normalizeHeadword(parseText(value.headword, MAX_HEADWORD_LENGTH)),
      messageVersion: currentVersion(value.messageVersion),
      type: "store/lexicon-presence",
    };
  }
  if (
    value.type !== "store/lexicon-save" ||
    !hasExactlyKeys(value, [
      "contextualMeaningZh",
      "headword",
      "messageVersion",
      "sentence",
      "type",
    ])
  ) {
    throw new TypeError("Store lexicon save request is invalid.");
  }
  return {
    contextualMeaningZh: parseText(
      value.contextualMeaningZh,
      MAX_LEXICON_CONTEXTUAL_MEANING_LENGTH,
    ),
    headword: normalizeHeadword(parseText(value.headword, MAX_HEADWORD_LENGTH)),
    messageVersion: currentVersion(value.messageVersion),
    sentence: parseText(value.sentence, MAX_CONTEXT_SENTENCE_LENGTH),
    type: "store/lexicon-save",
  };
}

export function parseStoreLexiconResponse(value: unknown): StoreLexiconResponse {
  if (!isRecord(value)) throw new TypeError("Store lexicon response is invalid.");
  const messageVersion = currentVersion(value.messageVersion);
  if (value.type === "store/lexicon-save-result") {
    if (
      !hasExactlyKeys(value, ["messageVersion", "status", "type"]) ||
      (value.status !== "saved" && value.status !== "duplicate")
    ) {
      throw new TypeError("Store lexicon save response is invalid.");
    }
    return { messageVersion, status: value.status, type: "store/lexicon-save-result" };
  }
  if (value.type === "store/lexicon-presence-result") {
    if (
      !hasExactlyKeys(value, ["messageVersion", "present", "type"]) ||
      typeof value.present !== "boolean"
    ) {
      throw new TypeError("Store lexicon presence response is invalid.");
    }
    return { messageVersion, present: value.present, type: "store/lexicon-presence-result" };
  }
  if (
    value.type !== "store/lexicon-error" ||
    !hasExactlyKeys(value, ["code", "messageVersion", "type"]) ||
    !["data-corrupt", "internal-error", "invalid-request"].includes(String(value.code))
  ) {
    throw new TypeError("Store lexicon error response is invalid.");
  }
  return { code: value.code as StoreLexiconErrorCode, messageVersion, type: "store/lexicon-error" };
}
