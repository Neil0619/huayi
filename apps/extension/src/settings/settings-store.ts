import {
  parseStoredSettings,
  type ExtensionSettings,
  type ParsedStoredSettings,
} from "./settings-domain.js";

export const SETTINGS_STORAGE_KEY = "settings";

export interface SettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface SettingsStorageChanges {
  addListener(
    listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void,
  ): void;
  removeListener(
    listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void,
  ): void;
}

export interface SettingsStoreOptions {
  area?: SettingsStorageArea;
  changes?: SettingsStorageChanges;
}

function chromeStorageArea(): SettingsStorageArea {
  return {
    get: async (key) => (await chrome.storage.local.get(key)) as Record<string, unknown>,
    set: async (items) => chrome.storage.local.set(items),
  };
}

function chromeStorageChanges(): SettingsStorageChanges {
  return {
    addListener: (listener) => chrome.storage.onChanged.addListener(listener),
    removeListener: (listener) => chrome.storage.onChanged.removeListener(listener),
  };
}

export class SettingsStore {
  private readonly area: SettingsStorageArea;
  private readonly changes: SettingsStorageChanges | undefined;

  constructor(options: SettingsStoreOptions = {}) {
    this.area = options.area ?? chromeStorageArea();
    this.changes =
      options.changes ?? (typeof chrome === "undefined" ? undefined : chromeStorageChanges());
  }

  async read(): Promise<ParsedStoredSettings> {
    const values = await this.area.get(SETTINGS_STORAGE_KEY);
    return parseStoredSettings(values[SETTINGS_STORAGE_KEY]);
  }

  replace(settings: ExtensionSettings): Promise<void> {
    const parsed = parseStoredSettings(settings);
    if (parsed.status !== "valid") throw new TypeError("Cannot store invalid extension settings.");
    return this.area.set({ [SETTINGS_STORAGE_KEY]: parsed.settings });
  }

  subscribe(listener: (settings: ParsedStoredSettings) => void): () => void {
    if (this.changes === undefined) return () => undefined;
    const handleChange = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ): void => {
      const change = changes[SETTINGS_STORAGE_KEY];
      if (areaName === "local" && change !== undefined) {
        listener(parseStoredSettings(change.newValue));
      }
    };
    this.changes.addListener(handleChange);
    return () => this.changes?.removeListener(handleChange);
  }
}
