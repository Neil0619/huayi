import { parseStoreAppearance, type StoreAppearance } from "./appearance.js";
import { STORE_MESSAGE_VERSION } from "./messages.js";
import type { StoreDefaultAction, StoreOverlayTheme } from "./settings.js";

export interface StoreSitePolicyQuery {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/site-policy";
}

export interface StoreSiteToggleRequest {
  readonly enabled: boolean;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/site-toggle";
}

export type StoreSitePolicyRequest = StoreSitePolicyQuery | StoreSiteToggleRequest;

export interface StoreSitePolicyResponse {
  readonly appearance: StoreAppearance;
  readonly defaultAction: StoreDefaultAction;
  readonly enabled: boolean;
  readonly globallyEnabled: boolean;
  readonly host: string;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly overlayTheme: StoreOverlayTheme;
  readonly type: "store/site-policy-result";
}

export type StoreSiteRelayMessage =
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/popup-site-policy";
    }
  | {
      readonly enabled: boolean;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/popup-site-toggle";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/site-policy-refresh";
    };

export interface StoreSitePoliciesChangedRequest {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/site-policies-changed";
}

export interface StoreSitePoliciesChangedResponse {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/site-policies-refreshed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function parseHost(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 253 ||
    value !== value.trim() ||
    value !== value.toLowerCase() ||
    /[\s/?#]/u.test(value)
  ) {
    throw new TypeError("Store site host is invalid.");
  }
  return value;
}

export function parseStoreSitePolicyRequest(value: unknown): StoreSitePolicyRequest {
  if (!isRecord(value) || value.messageVersion !== STORE_MESSAGE_VERSION) {
    throw new TypeError("Store site policy request is invalid.");
  }
  if (value.type === "store/site-policy" && exactKeys(value, ["messageVersion", "type"])) {
    return { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policy" };
  }
  if (
    value.type === "store/site-toggle" &&
    exactKeys(value, ["enabled", "messageVersion", "type"]) &&
    typeof value.enabled === "boolean"
  ) {
    return {
      enabled: value.enabled,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/site-toggle",
    };
  }
  throw new TypeError("Store site policy request is invalid.");
}

export function parseStoreSitePolicyResponse(value: unknown): StoreSitePolicyResponse {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "appearance",
      "defaultAction",
      "enabled",
      "globallyEnabled",
      "host",
      "messageVersion",
      "overlayTheme",
      "type",
    ]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/site-policy-result" ||
    typeof value.enabled !== "boolean" ||
    typeof value.globallyEnabled !== "boolean" ||
    (value.overlayTheme !== "parchment" && value.overlayTheme !== "pearl") ||
    (value.defaultAction !== "ask" &&
      value.defaultAction !== "explain" &&
      value.defaultAction !== "translate")
  ) {
    throw new TypeError("Store site policy response is invalid.");
  }
  return {
    appearance: parseStoreAppearance(value.appearance),
    defaultAction: value.defaultAction,
    enabled: value.enabled,
    globallyEnabled: value.globallyEnabled,
    host: parseHost(value.host),
    messageVersion: STORE_MESSAGE_VERSION,
    overlayTheme: value.overlayTheme,
    type: "store/site-policy-result",
  };
}

export function parseStoreSiteRelayMessage(value: unknown): StoreSiteRelayMessage {
  if (!isRecord(value) || value.messageVersion !== STORE_MESSAGE_VERSION) {
    throw new TypeError("Store site relay message is invalid.");
  }
  if (
    (value.type === "store/popup-site-policy" || value.type === "store/site-policy-refresh") &&
    exactKeys(value, ["messageVersion", "type"])
  ) {
    return { messageVersion: STORE_MESSAGE_VERSION, type: value.type };
  }
  if (
    value.type === "store/popup-site-toggle" &&
    exactKeys(value, ["enabled", "messageVersion", "type"]) &&
    typeof value.enabled === "boolean"
  ) {
    return {
      enabled: value.enabled,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/popup-site-toggle",
    };
  }
  throw new TypeError("Store site relay message is invalid.");
}

export function parseStoreSitePoliciesChangedRequest(
  value: unknown,
): StoreSitePoliciesChangedRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["messageVersion", "type"]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/site-policies-changed"
  ) {
    throw new TypeError("Store site policy change request is invalid.");
  }
  return { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policies-changed" };
}

export function parseStoreSitePoliciesChangedResponse(
  value: unknown,
): StoreSitePoliciesChangedResponse {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["messageVersion", "type"]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/site-policies-refreshed"
  ) {
    throw new TypeError("Store site policy change response is invalid.");
  }
  return { messageVersion: STORE_MESSAGE_VERSION, type: "store/site-policies-refreshed" };
}
