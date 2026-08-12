import type { VaultStorageAdapter } from "./vault-storage.js";

export interface ChromeVaultStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel(options: { readonly accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

export interface ChromeVaultStorage {
  readonly local: ChromeVaultStorageArea;
  readonly session: ChromeVaultStorageArea;
}

export function createChromeVaultStorageAdapter(
  chromeStorage: ChromeVaultStorage,
): VaultStorageAdapter {
  let preparation: Promise<void> | undefined;
  const prepare = (): Promise<void> => {
    preparation ??= Promise.all([
      chromeStorage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
      chromeStorage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    ]).then(() => undefined);
    return preparation;
  };
  const read = async (area: ChromeVaultStorageArea, key: string): Promise<unknown> => {
    await prepare();
    const values = await area.get(key);
    return values[key];
  };
  const write = async (
    area: ChromeVaultStorageArea,
    key: string,
    value: unknown,
  ): Promise<void> => {
    await prepare();
    await area.set({ [key]: value });
  };
  const remove = async (area: ChromeVaultStorageArea, key: string): Promise<void> => {
    await prepare();
    await area.remove(key);
  };
  return {
    prepare,
    deletePersistent: (key) => remove(chromeStorage.local, key),
    deleteSession: (key) => remove(chromeStorage.session, key),
    readPersistent: (key) => read(chromeStorage.local, key),
    readSession: (key) => read(chromeStorage.session, key),
    writePersistent: (key, value) => write(chromeStorage.local, key, value),
    writeSession: (key, value) => write(chromeStorage.session, key, value),
  };
}
