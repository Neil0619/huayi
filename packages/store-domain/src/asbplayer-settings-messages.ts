import { z } from "zod/v3";

import { parseStoreAppearance, type StoreAppearance } from "./appearance.js";
import { STORE_MESSAGE_VERSION } from "./messages.js";
import {
  asbplayerModeSchema,
  keyboardShortcutSchema,
  type AsbplayerMode,
  type StoreKeyboardShortcut,
} from "./settings.js";

export interface StoreAsbplayerSettingsRequest {
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/asbplayer-settings";
}

export interface StoreAsbplayerSettingsResponse {
  readonly appearance: StoreAppearance;
  readonly asbplayerMode: AsbplayerMode;
  readonly asbplayerShortcut: StoreKeyboardShortcut | null;
  readonly messageVersion: typeof STORE_MESSAGE_VERSION;
  readonly type: "store/asbplayer-settings-result";
}

const requestSchema = z.strictObject({
  messageVersion: z.literal(STORE_MESSAGE_VERSION),
  type: z.literal("store/asbplayer-settings"),
});
const responseSchema = z.strictObject({
  appearance: z.string(),
  asbplayerMode: asbplayerModeSchema,
  asbplayerShortcut: keyboardShortcutSchema.nullable(),
  messageVersion: z.literal(STORE_MESSAGE_VERSION),
  type: z.literal("store/asbplayer-settings-result"),
});

export function parseStoreAsbplayerSettingsRequest(value: unknown): StoreAsbplayerSettingsRequest {
  return requestSchema.parse(value);
}

export function parseStoreAsbplayerSettingsResponse(
  value: unknown,
): StoreAsbplayerSettingsResponse {
  const parsed = responseSchema.parse(value);
  return { ...parsed, appearance: parseStoreAppearance(parsed.appearance) };
}
