import { STORE_MESSAGE_VERSION } from "./messages.js";

type CaptureKind = "passage" | "phrase" | "sentence";
type CaptureTrigger = "automatic" | "manual";

export type StoreStudyCaptureRequest =
  | {
      readonly kind: CaptureKind;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly sourceText: string;
      readonly trigger: CaptureTrigger;
      readonly type: "store/study-capture-create";
    }
  | {
      readonly captureId: string;
      readonly expectedRevision: number;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/study-capture-undo-remote";
    }
  | {
      readonly localQueueId: string;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/study-capture-undo-local";
    };

export type StoreStudyCaptureResponse =
  | {
      readonly captureId: string;
      readonly expectedRevision: number;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome: "created";
      readonly type: "store/study-capture-result";
    }
  | {
      readonly localQueueId: string;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome: "queued";
      readonly type: "store/study-capture-result";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome:
        "existing" | "failed" | "linked-analysis" | "skipped" | "unavailable" | "undone";
      readonly type: "store/study-capture-result";
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function version(value: unknown): typeof STORE_MESSAGE_VERSION {
  if (value !== STORE_MESSAGE_VERSION) throw new TypeError("StudyCapture version is invalid.");
  return STORE_MESSAGE_VERSION;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new TypeError("StudyCapture identifier is invalid.");
  }
  return value;
}

export function parseStoreStudyCaptureRequest(value: unknown): StoreStudyCaptureRequest {
  if (!record(value)) throw new TypeError("StudyCapture request is invalid.");
  if (value.type === "store/study-capture-create") {
    if (!exact(value, ["kind", "messageVersion", "sourceText", "trigger", "type"])) {
      throw new TypeError("StudyCapture create request is invalid.");
    }
    if (value.kind !== "phrase" && value.kind !== "sentence" && value.kind !== "passage") {
      throw new TypeError("StudyCapture kind is invalid.");
    }
    if (value.trigger !== "automatic" && value.trigger !== "manual") {
      throw new TypeError("StudyCapture trigger is invalid.");
    }
    if (
      typeof value.sourceText !== "string" ||
      value.sourceText.trim().length === 0 ||
      value.sourceText.length > 2_000
    ) {
      throw new TypeError("StudyCapture text is invalid.");
    }
    return {
      kind: value.kind,
      messageVersion: version(value.messageVersion),
      sourceText: value.sourceText.trim(),
      trigger: value.trigger,
      type: "store/study-capture-create",
    };
  }
  if (value.type === "store/study-capture-undo-local") {
    if (!exact(value, ["localQueueId", "messageVersion", "type"])) {
      throw new TypeError("StudyCapture local undo is invalid.");
    }
    return {
      localQueueId: identifier(value.localQueueId),
      messageVersion: version(value.messageVersion),
      type: "store/study-capture-undo-local",
    };
  }
  if (
    !exact(value, ["captureId", "expectedRevision", "messageVersion", "type"]) ||
    value.type !== "store/study-capture-undo-remote"
  ) {
    throw new TypeError("StudyCapture remote undo is invalid.");
  }
  if (!Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) {
    throw new TypeError("StudyCapture revision is invalid.");
  }
  return {
    captureId: identifier(value.captureId),
    expectedRevision: Number(value.expectedRevision),
    messageVersion: version(value.messageVersion),
    type: "store/study-capture-undo-remote",
  };
}

export function parseStoreStudyCaptureResponse(value: unknown): StoreStudyCaptureResponse {
  if (!record(value) || value.type !== "store/study-capture-result") {
    throw new TypeError("StudyCapture response is invalid.");
  }
  const base = { messageVersion: version(value.messageVersion), type: value.type } as const;
  if (value.outcome === "created") {
    if (!exact(value, ["captureId", "expectedRevision", "messageVersion", "outcome", "type"]))
      throw new TypeError("StudyCapture response is invalid.");
    if (!Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 1)
      throw new TypeError("StudyCapture response is invalid.");
    return {
      ...base,
      captureId: identifier(value.captureId),
      expectedRevision: Number(value.expectedRevision),
      outcome: "created",
    };
  }
  if (value.outcome === "queued") {
    if (!exact(value, ["localQueueId", "messageVersion", "outcome", "type"]))
      throw new TypeError("StudyCapture response is invalid.");
    return { ...base, localQueueId: identifier(value.localQueueId), outcome: "queued" };
  }
  if (
    !exact(value, ["messageVersion", "outcome", "type"]) ||
    !["existing", "failed", "linked-analysis", "skipped", "unavailable", "undone"].includes(
      String(value.outcome),
    )
  ) {
    throw new TypeError("StudyCapture response is invalid.");
  }
  return {
    ...base,
    outcome: value.outcome as
      "existing" | "failed" | "linked-analysis" | "skipped" | "unavailable" | "undone",
  };
}
