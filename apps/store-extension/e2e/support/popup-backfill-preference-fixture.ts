import {
  POPUP_BACKFILL_PREFERENCE_KEY,
  type PopupBackfillPreferenceStorage,
} from "../../src/page-ui/popup-backfill-preference.js";

type Listener = Parameters<PopupBackfillPreferenceStorage["onChanged"]["addListener"]>[0];

export function createPopupBackfillPreferenceFixture(enabled: boolean) {
  const listeners = new Set<Listener>();
  if (enabled) localStorage.setItem(POPUP_BACKFILL_PREFERENCE_KEY, "true");
  const storage: PopupBackfillPreferenceStorage = {
    local: {
      async get(key) {
        const value = localStorage.getItem(key);
        return { [key]: value === null ? undefined : JSON.parse(value) };
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          localStorage.setItem(key, JSON.stringify(value));
          for (const listener of listeners) listener({ [key]: { newValue: value } }, "local");
        }
      },
    },
    onChanged: {
      addListener: (listener) => void listeners.add(listener),
      removeListener: (listener) => void listeners.delete(listener),
    },
  };
  return storage;
}
