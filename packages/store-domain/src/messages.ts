import {
  analysisActionSchema,
  analysisResultSchema,
  analysisUpdateSchema,
  type AnalysisAction,
  type AnalysisResult,
  type AnalysisUpdate,
} from "./analysis.js";
import { MAX_CONTEXT_SENTENCE_LENGTH } from "./normalization.js";
import { parseSelectionBoundaryEvidence, type SelectionBoundaryEvidence } from "./selection.js";

export const STORE_MESSAGE_VERSION = 5;

export interface StoreHandshakeEnvelope {
  readonly messageVersion: number;
  readonly requestId: string;
  readonly type: "store/handshake";
}

export interface StoreHandshakeRequest extends StoreHandshakeEnvelope {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
}

export type StoreHandshakeResponse =
  | {
      readonly compatible: true;
      readonly extensionVersion: string;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly requestId: string;
      readonly type: "store/handshake-result";
    }
  | {
      readonly compatible: false;
      readonly expectedMessageVersion: number;
      readonly receivedMessageVersion: number;
      readonly requestId: string;
      readonly type: "store/handshake-result";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function parseRequestId(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Store request ID is invalid.");
  const requestId = value.trim();
  if (requestId.length === 0 || requestId.length > 64) {
    throw new TypeError("Store request ID is invalid.");
  }
  return requestId;
}

function parseMessageVersion(value: unknown, allowZero: boolean): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError("Store message version is invalid.");
  }
  return value;
}

export const STORE_ANALYSIS_PORT_NAME = "huayi-store-analysis-v5";

export interface StoreOpenOptionsRequest {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/open-options";
}

export interface StoreOpenWebWorkspaceRequest {
  readonly destination?: "wordbooks";
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/open-web-workspace";
}

export type StoreOpenWebWorkspaceResponse =
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly opened: true;
      readonly type: "store/open-web-workspace-result";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly opened: false;
      readonly reason: "not-configured";
      readonly type: "store/open-web-workspace-result";
    };

export function parseStoreOpenWebWorkspaceRequest(value: unknown): StoreOpenWebWorkspaceRequest {
  if (
    !isRecord(value) ||
    !(
      hasExactlyKeys(value, ["messageVersion", "type"]) ||
      (hasExactlyKeys(value, ["destination", "messageVersion", "type"]) &&
        value.destination === "wordbooks")
    ) ||
    value.type !== "store/open-web-workspace"
  ) {
    throw new TypeError("Store open-Web-workspace request is invalid.");
  }
  return {
    ...(value.destination === "wordbooks" ? { destination: "wordbooks" as const } : {}),
    messageVersion: parseCurrentVersion(value.messageVersion),
    type: "store/open-web-workspace",
  };
}

export function parseStoreOpenWebWorkspaceResponse(value: unknown): StoreOpenWebWorkspaceResponse {
  if (!isRecord(value) || value.type !== "store/open-web-workspace-result") {
    throw new TypeError("Store open-Web-workspace response is invalid.");
  }
  const messageVersion = parseCurrentVersion(value.messageVersion);
  if (value.opened === true && hasExactlyKeys(value, ["messageVersion", "opened", "type"])) {
    return { messageVersion, opened: true, type: "store/open-web-workspace-result" };
  }
  if (
    value.opened === false &&
    value.reason === "not-configured" &&
    hasExactlyKeys(value, ["messageVersion", "opened", "reason", "type"])
  ) {
    return {
      messageVersion,
      opened: false,
      reason: "not-configured",
      type: "store/open-web-workspace-result",
    };
  }
  throw new TypeError("Store open-Web-workspace response is invalid.");
}

export function parseStoreOpenOptionsRequest(value: unknown): StoreOpenOptionsRequest {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["messageVersion", "type"]) ||
    value.type !== "store/open-options"
  ) {
    throw new TypeError("Store open-options request is invalid.");
  }
  return {
    messageVersion: parseCurrentVersion(value.messageVersion),
    type: "store/open-options",
  };
}

export interface StoreAnalysisStartMessage {
  readonly action: AnalysisAction;
  readonly boundaryEvidence: SelectionBoundaryEvidence;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly selection: string;
  readonly sentenceContext: string | null;
  readonly type: "store/analysis-start";
}

export interface StoreAnalysisCancelMessage {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/analysis-cancel";
}

export type StoreAnalysisClientMessage = StoreAnalysisStartMessage | StoreAnalysisCancelMessage;

export type StoreAnalysisErrorCode =
  | "busy"
  | "cancelled"
  | "cloud-access-denied"
  | "cloud-session-required"
  | "consent-required"
  | "credential-missing"
  | "internal-error"
  | "invalid-request"
  | "invalid-response"
  | "network-error"
  | "provider-error"
  | "quota-exhausted"
  | "timeout"
  | "version-mismatch";

export type StoreAnalysisServerMessage =
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/analysis-update";
      readonly update: AnalysisUpdate;
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly result: AnalysisResult;
      readonly type: "store/analysis-result";
    }
  | {
      readonly code: StoreAnalysisErrorCode;
      readonly diagnosticId?: string;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly requestId: string | null;
      readonly type: "store/analysis-error";
    };

function parseCurrentVersion(value: unknown): typeof STORE_MESSAGE_VERSION {
  if (value !== STORE_MESSAGE_VERSION) {
    throw new TypeError("Store analysis message version is incompatible.");
  }
  return STORE_MESSAGE_VERSION;
}

function parseBoundedString(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new TypeError("Store analysis text is invalid.");
  const parsed = value.trim();
  if (parsed.length < minimum || parsed.length > maximum) {
    throw new TypeError("Store analysis text is invalid.");
  }
  return parsed;
}

export function parseAnalysisClientMessage(value: unknown): StoreAnalysisClientMessage {
  if (!isRecord(value)) throw new TypeError("Store analysis message is invalid.");
  if (value.type === "store/analysis-cancel") {
    if (!hasExactlyKeys(value, ["messageVersion", "type"])) {
      throw new TypeError("Store analysis cancellation is invalid.");
    }
    return {
      messageVersion: parseCurrentVersion(value.messageVersion),
      type: "store/analysis-cancel",
    };
  }
  if (
    value.type !== "store/analysis-start" ||
    !hasExactlyKeys(value, [
      "action",
      "boundaryEvidence",
      "messageVersion",
      "selection",
      "sentenceContext",
      "type",
    ])
  ) {
    throw new TypeError("Store analysis start is invalid.");
  }
  const sentenceContext =
    value.sentenceContext === null
      ? null
      : parseBoundedString(value.sentenceContext, 1, MAX_CONTEXT_SENTENCE_LENGTH);
  return {
    action: analysisActionSchema.parse(value.action),
    boundaryEvidence: parseSelectionBoundaryEvidence(value.boundaryEvidence),
    messageVersion: parseCurrentVersion(value.messageVersion),
    selection: parseBoundedString(value.selection, 1, MAX_CONTEXT_SENTENCE_LENGTH),
    sentenceContext,
    type: "store/analysis-start",
  };
}

const STORE_ANALYSIS_ERROR_CODES: readonly StoreAnalysisErrorCode[] = [
  "busy",
  "cancelled",
  "cloud-access-denied",
  "cloud-session-required",
  "consent-required",
  "credential-missing",
  "internal-error",
  "invalid-request",
  "invalid-response",
  "network-error",
  "provider-error",
  "quota-exhausted",
  "timeout",
  "version-mismatch",
];

export function parseAnalysisServerMessage(value: unknown): StoreAnalysisServerMessage {
  if (!isRecord(value)) throw new TypeError("Store analysis response is invalid.");
  const messageVersion = parseCurrentVersion(value.messageVersion);
  if (value.type === "store/analysis-update") {
    if (!hasExactlyKeys(value, ["messageVersion", "type", "update"])) {
      throw new TypeError("Store analysis update is invalid.");
    }
    return {
      messageVersion,
      type: "store/analysis-update",
      update: analysisUpdateSchema.parse(value.update),
    };
  }
  if (value.type === "store/analysis-result") {
    if (!hasExactlyKeys(value, ["messageVersion", "result", "type"])) {
      throw new TypeError("Store analysis result is invalid.");
    }
    return {
      messageVersion,
      result: analysisResultSchema.parse(value.result),
      type: "store/analysis-result",
    };
  }
  if (
    value.type !== "store/analysis-error" ||
    !hasExactlyKeys(
      value,
      value.diagnosticId === undefined
        ? ["code", "messageVersion", "requestId", "type"]
        : ["code", "diagnosticId", "messageVersion", "requestId", "type"],
    ) ||
    typeof value.code !== "string" ||
    !STORE_ANALYSIS_ERROR_CODES.includes(value.code as StoreAnalysisErrorCode)
  ) {
    throw new TypeError("Store analysis error is invalid.");
  }
  return {
    code: value.code as StoreAnalysisErrorCode,
    ...(value.diagnosticId === undefined
      ? {}
      : { diagnosticId: parseRequestId(value.diagnosticId) }),
    messageVersion,
    requestId: value.requestId === null ? null : parseRequestId(value.requestId),
    type: "store/analysis-error",
  };
}

export function parseStoreHandshakeEnvelope(value: unknown): StoreHandshakeEnvelope {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["messageVersion", "requestId", "type"]) ||
    value.type !== "store/handshake"
  ) {
    throw new TypeError("Store handshake is invalid.");
  }
  return {
    messageVersion: parseMessageVersion(value.messageVersion, true),
    requestId: parseRequestId(value.requestId),
    type: "store/handshake",
  };
}

export function parseStoreHandshakeRequest(value: unknown): StoreHandshakeRequest {
  const envelope = parseStoreHandshakeEnvelope(value);
  if (envelope.messageVersion !== STORE_MESSAGE_VERSION) {
    throw new TypeError("Store handshake version is incompatible.");
  }
  return { ...envelope, messageVersion: STORE_MESSAGE_VERSION };
}

export function parseStoreHandshakeResponse(value: unknown): StoreHandshakeResponse {
  if (!isRecord(value) || value.type !== "store/handshake-result") {
    throw new TypeError("Store handshake response is invalid.");
  }
  const requestId = parseRequestId(value.requestId);
  if (value.compatible === true) {
    if (
      !hasExactlyKeys(value, [
        "compatible",
        "extensionVersion",
        "messageVersion",
        "requestId",
        "type",
      ]) ||
      typeof value.extensionVersion !== "string" ||
      value.extensionVersion.trim().length === 0 ||
      value.extensionVersion.trim().length > 40 ||
      value.messageVersion !== STORE_MESSAGE_VERSION
    ) {
      throw new TypeError("Store handshake response is invalid.");
    }
    return {
      compatible: true,
      extensionVersion: value.extensionVersion.trim(),
      messageVersion: STORE_MESSAGE_VERSION,
      requestId,
      type: "store/handshake-result",
    };
  }
  if (
    value.compatible !== false ||
    !hasExactlyKeys(value, [
      "compatible",
      "expectedMessageVersion",
      "receivedMessageVersion",
      "requestId",
      "type",
    ])
  ) {
    throw new TypeError("Store handshake response is invalid.");
  }
  return {
    compatible: false,
    expectedMessageVersion: parseMessageVersion(value.expectedMessageVersion, false),
    receivedMessageVersion: parseMessageVersion(value.receivedMessageVersion, true),
    requestId,
    type: "store/handshake-result",
  };
}
