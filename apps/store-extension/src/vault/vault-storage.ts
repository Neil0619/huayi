export interface VaultStorageAdapter {
  prepare(): Promise<void>;
  readPersistent(key: string): Promise<unknown>;
  writePersistent(key: string, value: unknown): Promise<void>;
  deletePersistent(key: string): Promise<void>;
  readSession(key: string): Promise<unknown>;
  writeSession(key: string, value: unknown): Promise<void>;
  deleteSession(key: string): Promise<void>;
}

export const VAULT_METADATA_STORAGE_KEY = "huayi.store.vault.metadata";
export const VAULT_SESSION_STORAGE_KEY = "huayi.store.vault.session";
export const DEVICE_VAULT_KEY_STORAGE_KEY = "huayi.store.device-vault.key";

export function credentialStorageKey(slot: string): string {
  return `huayi.store.vault.credential.${slot}`;
}
