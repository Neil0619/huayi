import { parseStoreAppearance, type StoreAppearance } from "./appearance.js";
import { STORE_MESSAGE_VERSION } from "./messages.js";
import type { StoreKeyboardShortcut, YouTubeMode } from "./settings.js";

export interface StoreContentSettingsRequest {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/content-settings";
}

export interface StoreContentSettingsResponse {
  readonly appearance: StoreAppearance;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/content-settings-result";
  readonly youtubeMode: YouTubeMode;
  readonly youtubeShortcut: StoreKeyboardShortcut | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export function parseStoreContentSettingsRequest(value: unknown): StoreContentSettingsRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["messageVersion", "type"]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/content-settings"
  ) {
    throw new TypeError("Store content settings request is invalid.");
  }
  return { messageVersion: STORE_MESSAGE_VERSION, type: "store/content-settings" };
}

export function parseStoreContentSettingsResponse(value: unknown): StoreContentSettingsResponse {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["appearance", "messageVersion", "type", "youtubeMode", "youtubeShortcut"]) ||
    value.messageVersion !== STORE_MESSAGE_VERSION ||
    value.type !== "store/content-settings-result"
  ) {
    throw new TypeError("Store content settings response is invalid.");
  }
  const shortcut = value.youtubeShortcut;
  if (
    shortcut !== null &&
    (!isRecord(shortcut) ||
      !exactKeys(shortcut, ["alt", "code", "ctrl", "meta", "shift"]) ||
      typeof shortcut.alt !== "boolean" ||
      typeof shortcut.code !== "string" ||
      typeof shortcut.ctrl !== "boolean" ||
      typeof shortcut.meta !== "boolean" ||
      typeof shortcut.shift !== "boolean" ||
      !/^(?:Key[A-Z]|Digit\d|F(?:[1-9]|1\d|2[0-4]))$/u.test(shortcut.code) ||
      (!shortcut.alt && !shortcut.ctrl && !shortcut.meta && !shortcut.shift))
  ) {
    throw new TypeError("Store content settings response is invalid.");
  }
  return {
    appearance: parseStoreAppearance(value.appearance),
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/content-settings-result",
    youtubeMode:
      value.youtubeMode === "disabled" ||
      value.youtubeMode === "english" ||
      value.youtubeMode === "bilingual"
        ? value.youtubeMode
        : (() => {
            throw new TypeError("Store content settings response is invalid.");
          })(),
    youtubeShortcut:
      shortcut === null
        ? null
        : {
            alt: shortcut.alt as boolean,
            code: shortcut.code as string,
            ctrl: shortcut.ctrl as boolean,
            meta: shortcut.meta as boolean,
            shift: shortcut.shift as boolean,
          },
  };
}
