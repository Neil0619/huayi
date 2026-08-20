import { extensionPreferencesResponseSchema, identityHttpRoutes } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createExtensionPreferencesApp } from "./extension-preferences-app.js";

const preferences = extensionPreferencesResponseSchema.parse({
  cloudWordCopyMode: "enabled",
  extensionQueryModelMode: "byok",
  revision: 3,
  studyCaptureMode: "automatic",
  updatedAt: "2026-08-13T00:00:00.000Z",
});

describe("Extension preferences HTTP projection", () => {
  it("returns only the authenticated device owner's global extension preferences", async () => {
    const authenticate = vi.fn(async () => "owner-a");
    const read = vi.fn(async () => preferences);
    const response = await createExtensionPreferencesApp({ authenticate, read }).request(
      identityHttpRoutes.extensionPreferences,
      { headers: { Authorization: `HuayiExtension ${"s".repeat(43)}` } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(preferences);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(read).toHaveBeenCalledWith("owner-a");
  });

  it("does not accept owner or preference overrides from the query string", async () => {
    const read = vi.fn(async () => preferences);
    const app = createExtensionPreferencesApp({ authenticate: async () => "owner-a", read });

    const response = await app.request(
      `${identityHttpRoutes.extensionPreferences}?owner=owner-b&studyCaptureMode=manual`,
    );
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
});
