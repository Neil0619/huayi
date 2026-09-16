/** Non-sensitive, extension-wide local UI preference; independent of account/backfill state. */
export const POPUP_BACKFILL_PREFERENCE_KEY = "huayi.store.ui.popup-backfill-visible.v1";

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
export interface PopupBackfillPreferenceStorage {
  local: {
    get(key: string): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };
  onChanged: {
    addListener(listener: StorageListener): void;
    removeListener(listener: StorageListener): void;
  };
}

export function savePopupBackfillPreference(
  storage: PopupBackfillPreferenceStorage,
  visible: boolean,
): Promise<void> {
  return storage.local.set({ [POPUP_BACKFILL_PREFERENCE_KEY]: visible === true });
}

export function observePopupBackfillPreference(
  storage: PopupBackfillPreferenceStorage,
  changed: (visible: boolean) => void,
  failed: () => void,
) {
  let revision = 0;
  let disposed = false;
  const refresh = async () => {
    if (disposed) return;
    const current = ++revision;
    try {
      const values = await storage.local.get(POPUP_BACKFILL_PREFERENCE_KEY);
      if (!disposed && current === revision)
        changed(values[POPUP_BACKFILL_PREFERENCE_KEY] === true);
    } catch {
      if (!disposed && current === revision) failed();
    }
  };
  const listener: StorageListener = (changes, area) => {
    if (disposed || area !== "local" || !(POPUP_BACKFILL_PREFERENCE_KEY in changes)) return;
    // An event contains the committed value; an older in-flight read cannot override it.
    revision += 1;
    changed(changes[POPUP_BACKFILL_PREFERENCE_KEY]?.newValue === true);
  };
  storage.onChanged.addListener(listener);
  void refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      revision += 1;
      storage.onChanged.removeListener(listener);
    },
  };
}
