import { STORE_MESSAGE_VERSION } from "./messages.js";

export interface SubmissionOutboxRequest {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type:
    | "store/submission-outbox-clear"
    | "store/submission-outbox-retry"
    | "store/submission-outbox-status";
}

export type SubmissionOutboxState =
  | "client-upgrade-required"
  | "empty"
  | "not-configured"
  | "queued"
  | "session-unavailable"
  | "upload-disabled";

export type SubmissionOutboxOutcome =
  | "cleared"
  | "client-upgrade-required"
  | "discarded"
  | "idle"
  | "retry-pending"
  | "session-invalid"
  | "status"
  | "submitted";

export type SubmissionOutboxResponse =
  | {
      readonly count: number;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly oldestQueuedAt: string;
      readonly outcome: SubmissionOutboxOutcome;
      readonly state: "client-upgrade-required" | "not-configured" | "queued";
      readonly type: "store/submission-outbox-result";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly outcome: SubmissionOutboxOutcome;
      readonly state: Exclude<SubmissionOutboxState, "client-upgrade-required" | "queued">;
      readonly type: "store/submission-outbox-result";
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function version(value: unknown): typeof STORE_MESSAGE_VERSION {
  if (value !== STORE_MESSAGE_VERSION) throw new TypeError("SubmissionOutbox version is invalid.");
  return STORE_MESSAGE_VERSION;
}

function outcome(value: unknown): SubmissionOutboxOutcome {
  if (
    value !== "cleared" &&
    value !== "client-upgrade-required" &&
    value !== "discarded" &&
    value !== "idle" &&
    value !== "retry-pending" &&
    value !== "session-invalid" &&
    value !== "status" &&
    value !== "submitted"
  ) {
    throw new TypeError("SubmissionOutbox outcome is invalid.");
  }
  return value;
}

function isoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function parseSubmissionOutboxRequest(value: unknown): SubmissionOutboxRequest {
  if (!record(value) || !exact(value, ["messageVersion", "type"])) {
    throw new TypeError("SubmissionOutbox request is invalid.");
  }
  if (
    value.type !== "store/submission-outbox-clear" &&
    value.type !== "store/submission-outbox-retry" &&
    value.type !== "store/submission-outbox-status"
  ) {
    throw new TypeError("SubmissionOutbox request is invalid.");
  }
  return { messageVersion: version(value.messageVersion), type: value.type };
}

export function parseSubmissionOutboxResponse(value: unknown): SubmissionOutboxResponse {
  if (!record(value) || value.type !== "store/submission-outbox-result") {
    throw new TypeError("SubmissionOutbox response is invalid.");
  }
  const messageVersion = version(value.messageVersion);
  const parsedOutcome = outcome(value.outcome);
  if (
    value.state === "client-upgrade-required" ||
    value.state === "queued" ||
    (value.state === "not-configured" && ("count" in value || "oldestQueuedAt" in value))
  ) {
    if (
      !exact(value, ["count", "messageVersion", "oldestQueuedAt", "outcome", "state", "type"]) ||
      !Number.isInteger(value.count) ||
      (value.count as number) < 1 ||
      (value.count as number) > 20 ||
      !isoTimestamp(value.oldestQueuedAt)
    ) {
      throw new TypeError("SubmissionOutbox queued response is invalid.");
    }
    return {
      count: value.count as number,
      messageVersion,
      oldestQueuedAt: value.oldestQueuedAt,
      outcome: parsedOutcome,
      state: value.state,
      type: "store/submission-outbox-result",
    };
  }
  if (
    !exact(value, ["messageVersion", "outcome", "state", "type"]) ||
    (value.state !== "empty" &&
      value.state !== "not-configured" &&
      value.state !== "session-unavailable" &&
      value.state !== "upload-disabled")
  ) {
    throw new TypeError("SubmissionOutbox response is invalid.");
  }
  return {
    messageVersion,
    outcome: parsedOutcome,
    state: value.state,
    type: "store/submission-outbox-result",
  };
}
