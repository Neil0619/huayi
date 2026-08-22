import { afterEach, describe, expect, it, vi } from "vitest";

import { createAcceptanceApp } from "./acceptance-app.js";
import { acceptanceProviderFetch } from "./acceptance-provider-fetch.js";

describe("local acceptance API composition", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps invalid model requests inside the acceptance adapter", async () => {
    await expect(
      acceptanceProviderFetch("https://api.deepseek.com/chat/completions", {
        body: "private content",
        credentials: "omit",
        headers: { Authorization: "Bearer private-key" },
        method: "POST",
        redirect: "error",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Local acceptance model request is invalid.");
  });

  it("keeps the security notification route explicit and zero-network", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network must remain disabled");
    });
    vi.stubGlobal("fetch", fetch);
    const cronSecret = "c".repeat(32);
    const app = createAcceptanceApp({
      CRON_SECRET: cronSecret,
      HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports-acceptance",
      HUAYI_API_ORIGIN: "https://api.acceptance.localhost:8444",
      HUAYI_DATABASE_URL: "postgresql://huayi_acceptance_login:acceptance@127.0.0.1:54322/postgres",
      HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
      HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
      HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
      HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
      HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
      HUAYI_SECRET_PEPPER: "p".repeat(32),
      HUAYI_SECURITY_NOTIFICATION_MODE: "disabled-local-acceptance",
      HUAYI_STORE_EXTENSION_CAPABILITY: "enabled",
      HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
      HUAYI_WEB_ORIGIN: "https://app.acceptance.localhost:8443",
      SUPABASE_PUBLISHABLE_KEY: "publishable-local-acceptance",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-local-acceptance",
      SUPABASE_URL: "https://supabase.acceptance.localhost:8445",
    });

    const response = await app.request("/internal/security-notifications/run", {
      headers: { authorization: `Bearer ${cronSecret}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "idle" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
