import {
  DEFAULT_STORE_APPEARANCE,
  parseStoreAppearance,
  type StoreAppearance,
} from "@huayi/store-domain";

export const STORE_APPEARANCE_STORAGE_KEY = "huayi.store.appearance.v1";

export interface ChromeAppearanceStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel(options: { readonly accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

export interface StoreAppearanceRepository {
  get(): Promise<StoreAppearance>;
  set(appearance: StoreAppearance): Promise<void>;
}

class ChromeStoreAppearance implements StoreAppearanceRepository {
  private preparation: Promise<void> | undefined;

  constructor(private readonly storage: ChromeAppearanceStorageArea) {}

  async get(): Promise<StoreAppearance> {
    try {
      await this.prepare();
      const values = await this.storage.get(STORE_APPEARANCE_STORAGE_KEY);
      const persisted = values[STORE_APPEARANCE_STORAGE_KEY];
      if (persisted === undefined) return DEFAULT_STORE_APPEARANCE;
      return parseStoreAppearance(persisted);
    } catch {
      return DEFAULT_STORE_APPEARANCE;
    }
  }

  async set(appearance: StoreAppearance): Promise<void> {
    const parsed = parseStoreAppearance(appearance);
    await this.prepare();
    await this.storage.set({ [STORE_APPEARANCE_STORAGE_KEY]: parsed });
  }

  private prepare(): Promise<void> {
    this.preparation ??= this.storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    return this.preparation;
  }
}

export function createChromeStoreAppearance(
  storage: ChromeAppearanceStorageArea,
): StoreAppearanceRepository {
  return new ChromeStoreAppearance(storage);
}
