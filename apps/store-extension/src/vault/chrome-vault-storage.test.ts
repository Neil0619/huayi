import { describe, expect, it, vi } from "vitest";

import {
  createChromeVaultStorageAdapter,
  type ChromeVaultStorageArea,
} from "./chrome-vault-storage.js";

function createStorageArea(): ChromeVaultStorageArea & {
  readonly values: Map<string, unknown>;
  readonly setAccessLevel: ReturnType<typeof vi.fn>;
} {
  const values = new Map<string, unknown>();
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        values.set(key, structuredClone(value));
      }
    }),
    setAccessLevel: vi.fn(async () => undefined),
  };
}

describe("Chrome vault storage adapter", () => {
  it("restricts local and session storage before allowing access", async () => {
    const local = createStorageArea();
    const session = createStorageArea();
    const storage = createChromeVaultStorageAdapter({ local, session });

    await storage.prepare();
    await storage.prepare();

    expect(local.setAccessLevel).toHaveBeenCalledOnce();
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    expect(session.setAccessLevel).toHaveBeenCalledOnce();
    expect(session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("keeps persistent and session values in their respective Chrome areas", async () => {
    const local = createStorageArea();
    const session = createStorageArea();
    const storage = createChromeVaultStorageAdapter({ local, session });
    await storage.prepare();

    await storage.writePersistent("persistent", { encrypted: true });
    await storage.writeSession("session", { dek: "session-only" });

    await expect(storage.readPersistent("persistent")).resolves.toEqual({ encrypted: true });
    await expect(storage.readSession("session")).resolves.toEqual({ dek: "session-only" });
    expect(local.values.has("session")).toBe(false);
    expect(session.values.has("persistent")).toBe(false);

    await storage.deletePersistent("persistent");
    await storage.deleteSession("session");
    await expect(storage.readPersistent("persistent")).resolves.toBeUndefined();
    await expect(storage.readSession("session")).resolves.toBeUndefined();
  });
});
