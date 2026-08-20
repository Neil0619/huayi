import { STORE_MESSAGE_VERSION } from "./messages.js";

export interface CloudSessionRequest {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type:
    "store/cloud-session-disconnect" | "store/cloud-session-start" | "store/cloud-session-status";
}

export type CloudSessionResponse =
  | {
      readonly expiresAt: string;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly status: "connected" | "pairing";
      readonly type: "store/cloud-session-result";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly status: "disconnected" | "expired" | "not-configured";
      readonly type: "store/cloud-session-result";
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function version(value: unknown): typeof STORE_MESSAGE_VERSION {
  if (value !== STORE_MESSAGE_VERSION) throw new TypeError("Cloud session version is invalid.");
  return STORE_MESSAGE_VERSION;
}

function expiresAt(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError("Cloud session expiry is invalid.");
  }
  return value;
}

export function parseCloudSessionRequest(value: unknown): CloudSessionRequest {
  if (!record(value) || !exact(value, ["messageVersion", "type"])) {
    throw new TypeError("Cloud session request is invalid.");
  }
  if (
    value.type !== "store/cloud-session-disconnect" &&
    value.type !== "store/cloud-session-start" &&
    value.type !== "store/cloud-session-status"
  ) {
    throw new TypeError("Cloud session request is invalid.");
  }
  return { messageVersion: version(value.messageVersion), type: value.type };
}

export function parseCloudSessionResponse(value: unknown): CloudSessionResponse {
  if (!record(value) || value.type !== "store/cloud-session-result") {
    throw new TypeError("Cloud session response is invalid.");
  }
  const messageVersion = version(value.messageVersion);
  if (
    (value.status === "connected" || value.status === "pairing") &&
    exact(value, ["expiresAt", "messageVersion", "status", "type"])
  ) {
    return {
      expiresAt: expiresAt(value.expiresAt),
      messageVersion,
      status: value.status,
      type: "store/cloud-session-result",
    };
  }
  if (
    (value.status === "disconnected" ||
      value.status === "expired" ||
      value.status === "not-configured") &&
    exact(value, ["messageVersion", "status", "type"])
  ) {
    return { messageVersion, status: value.status, type: "store/cloud-session-result" };
  }
  throw new TypeError("Cloud session response is invalid.");
}
