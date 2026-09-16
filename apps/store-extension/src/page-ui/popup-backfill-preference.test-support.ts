import { vi } from "vitest";
import {
  POPUP_BACKFILL_PREFERENCE_KEY,
  type PopupBackfillPreferenceStorage,
} from "./popup-backfill-preference.js";

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

export function preferenceStorage(initial?: unknown) {
  const values: Record<string, unknown> = {
    credentials: "unchanged",
    provider: "unchanged",
    consent: "unchanged",
    backfill: "unchanged",
    [POPUP_BACKFILL_PREFERENCE_KEY]: initial,
  };
  type Listener = Parameters<PopupBackfillPreferenceStorage["onChanged"]["addListener"]>[0];
  const listeners = new Set<Listener>();
  const emit = (value: unknown, area = "local", key = POPUP_BACKFILL_PREFERENCE_KEY) => {
    if (area === "local") values[key] = value;
    for (const listener of listeners) listener({ [key]: { newValue: value } }, area);
  };
  const storage = {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) emit(value, "local", key);
      }),
    },
    onChanged: {
      addListener: (listener: Listener) => void listeners.add(listener),
      removeListener: (listener: Listener) => void listeners.delete(listener),
    },
  };
  return { storage, values, listeners, emit };
}
