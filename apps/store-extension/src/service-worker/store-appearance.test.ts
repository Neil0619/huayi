import { describe, expect, it, vi } from "vitest";

import {
  STORE_APPEARANCE_STORAGE_KEY,
  createChromeStoreAppearance,
  type ChromeAppearanceStorageArea,
} from "./store-appearance.js";

function area(initial?: unknown): ChromeAppearanceStorageArea & {
  readonly values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(STORE_APPEARANCE_STORAGE_KEY, initial);
  values.set("huayi.store.settings", { schemaVersion: 6, sentinel: "unchanged" });
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    }),
    setAccessLevel: vi.fn(async () => undefined),
  };
}

describe("Chrome Store appearance", () => {
  it("uses an independent versioned key and defaults to silver without rewriting settings", async () => {
    const local = area();
    const appearance = createChromeStoreAppearance(local);

    await expect(appearance.get()).resolves.toBe("silver");
    expect(STORE_APPEARANCE_STORAGE_KEY).toBe("huayi.store.appearance.v1");
    expect(local.set).not.toHaveBeenCalled();
    expect(local.values.get("huayi.store.settings")).toEqual({
      schemaVersion: 6,
      sentinel: "unchanged",
    });
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it.each(["dark", "silver ", 1, null, {}])("defaults an invalid value %j", async (value) => {
    await expect(createChromeStoreAppearance(area(value)).get()).resolves.toBe("silver");
  });

  it("defaults when storage cannot be read", async () => {
    const local = area();
    vi.mocked(local.get).mockRejectedValueOnce(new Error("unavailable"));

    await expect(createChromeStoreAppearance(local).get()).resolves.toBe("silver");
  });

  it("persists only a strict appearance and surfaces write failures", async () => {
    const local = area("moon");
    const appearance = createChromeStoreAppearance(local);

    await expect(appearance.get()).resolves.toBe("moon");
    await appearance.set("champagne");
    expect(local.values.get(STORE_APPEARANCE_STORAGE_KEY)).toBe("champagne");
    expect(local.values.get("huayi.store.settings")).toEqual({
      schemaVersion: 6,
      sentinel: "unchanged",
    });

    vi.mocked(local.set).mockRejectedValueOnce(new Error("disk full"));
    await expect(appearance.set("porcelain")).rejects.toThrow("disk full");
  });
});
