import { parseStoreAppearance, type StoreAppearance } from "./appearance.js";
import { STORE_MESSAGE_VERSION } from "./messages.js";
import type { StoreOverlayTheme } from "./settings.js";

export interface StorePopupStatusRequest {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/popup-status";
}

export interface StorePopupStatusResponse {
  readonly appearance: StoreAppearance;
  readonly globallyEnabled: boolean;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly modelConsentGranted: boolean;
  readonly overlayTheme: StoreOverlayTheme;
  readonly providerId: "deepseek" | "openai";
  readonly type: "store/popup-status-result";
}

export type StorePopupPreferenceRequest =
  | {
      readonly enabled: boolean;
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly type: "store/popup-global-toggle";
    }
  | {
      readonly messageVersion: typeof STORE_MESSAGE_VERSION;
      readonly overlayTheme: StoreOverlayTheme;
      readonly type: "store/popup-overlay-theme";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export function parseStorePopupStatusRequest(value: unknown): StorePopupStatusRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["messageVersion", "type"]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/popup-status"
  ) {
    throw new TypeError("Store popup status request is invalid.");
  }
  return { messageVersion: STORE_MESSAGE_VERSION, type: "store/popup-status" };
}

export function parseStorePopupStatusResponse(value: unknown): StorePopupStatusResponse {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "appearance",
      "globallyEnabled",
      "messageVersion",
      "modelConsentGranted",
      "overlayTheme",
      "providerId",
      "type",
    ]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/popup-status-result" ||
    (value.providerId !== "openai" && value.providerId !== "deepseek") ||
    typeof value.modelConsentGranted !== "boolean" ||
    typeof value.globallyEnabled !== "boolean" ||
    (value.overlayTheme !== "parchment" && value.overlayTheme !== "pearl")
  ) {
    throw new TypeError("Store popup status response is invalid.");
  }
  return {
    appearance: parseStoreAppearance(value.appearance),
    globallyEnabled: value.globallyEnabled,
    messageVersion: STORE_MESSAGE_VERSION,
    modelConsentGranted: value.modelConsentGranted,
    overlayTheme: value.overlayTheme,
    providerId: value.providerId,
    type: "store/popup-status-result",
  };
}

export function parseStorePopupPreferenceRequest(value: unknown): StorePopupPreferenceRequest {
  if (!isRecord(value) || value.messageVersion !== STORE_MESSAGE_VERSION) {
    throw new TypeError("Store popup preference request is invalid.");
  }
  if (
    value.type === "store/popup-global-toggle" &&
    exactKeys(value, ["enabled", "messageVersion", "type"]) &&
    typeof value.enabled === "boolean"
  ) {
    return {
      enabled: value.enabled,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/popup-global-toggle",
    };
  }
  if (
    value.type === "store/popup-overlay-theme" &&
    exactKeys(value, ["messageVersion", "overlayTheme", "type"]) &&
    (value.overlayTheme === "parchment" || value.overlayTheme === "pearl")
  ) {
    return {
      messageVersion: STORE_MESSAGE_VERSION,
      overlayTheme: value.overlayTheme,
      type: "store/popup-overlay-theme",
    };
  }
  throw new TypeError("Store popup preference request is invalid.");
}
