import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  authenticateProductionAnalysisRequest,
  authenticateProductionPrincipalRequest,
  createProductionApp,
  duplicateSuggestionCleanupRoute,
} from "./production-app.js";

describe("production API composition", () => {
  it("wires the fail-closed adapters without contacting external services for health", async () => {
    const app = createProductionApp({
      HUAYI_API_ORIGIN: "https://api.huayi.example",
      HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
      CRON_SECRET: "cron-test-secret-at-least-32-characters",
      HUAYI_DATABASE_URL: "postgresql://runtime:password@database.example:5432/huayi",
      HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
      HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
      HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
      HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
      HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
      HUAYI_SECRET_PEPPER: "production-test-pepper-at-least-32-characters",
      HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
      HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
      HUAYI_WEB_ORIGIN: "https://app.huayi.example",
      SUPABASE_PUBLISHABLE_KEY: "publishable-test-key-at-least-20-characters",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key-at-least-20-characters",
      SUPABASE_URL: "https://project.supabase.co",
    });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ service: "huayi-cloud-api", status: "ok" });
    expect(app.routes.map((route) => route.path)).toContain("/v1/analyses:stream");
    expect(app.routes.map((route) => route.path)).toContain("/v1/extension-queries:stream");
    expect(app.routes.map((route) => route.path)).toContain("/v1/extension-query-generations/:id");
    expect(app.routes.map((route) => route.path)).toContain("/v1/extension-session");
    expect(app.routes.map((route) => route.path)).not.toContain("/v1/analyses:import");
    expect(app.routes.map((route) => route.path)).toContain("/v1/learning-items");
    expect(app.routes.map((route) => route.path)).toContain("/v1/practice/daily-queue");
    expect(app.routes.map((route) => route.path)).toContain("/v1/practice/dialogue-sessions");
    expect(app.routes.map((route) => route.path)).toContain("/v1/practice/sessions/:id/turns");
    expect(app.routes.map((route) => route.path)).toContain("/v1/words");
    expect(app.routes.map((route) => route.path)).toContain("/v1/account/preferences");
    expect(app.routes.map((route) => route.path)).toContain("/v1/account");
    expect(app.routes.map((route) => route.path)).toContain("/v1/account-data-exports");
    expect(app.routes.map((route) => route.path)).toContain("/v1/account-deletion");
    expect(app.routes.map((route) => route.path)).toContain("/v1/admin/audit-events");
    expect(app.routes.map((route) => route.path)).toContain("/v1/admin/runtime/model-kill-switch");
    expect(app.routes.map((route) => route.path)).toContain("/internal/data-rights/run");
    expect(app.routes.map((route) => route.path)).toContain("/internal/extension-queries/cleanup");
    expect(app.routes.map((route) => route.path)).toContain(duplicateSuggestionCleanupRoute);
    expect(app.routes.map((route) => route.path)).toContain("/v1/auth/password/recovery");
    expect(app.routes.map((route) => route.path)).toContain("/v1/auth/password/recovery/confirm");
    expect(app.routes.map((route) => route.path)).toContain("/v1/auth/password/recovery/callback");
    expect(app.routes.map((route) => route.path)).toContain("/v1/auth/password/recovery/session");
    expect(app.routes.map((route) => route.path)).toContain("/v1/auth/password/recovery/complete");
    expect(app.routes.map((route) => route.path)).toContain("/internal/password-recovery/run");
    expect(app.routes.map((route) => route.path)).toContain("/v1/wordbook-jobs/:id/lease");
    const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
    const missingOrigin = await app.request("/v1/analyses:stream", {
      headers: {
        authorization: `HuayiExtension ${"s".repeat(43)}`,
        "x-huayi-client-version": "1.0.0",
      },
      method: "POST",
    });
    expect(missingOrigin.status).toBe(403);
    const blockedExtensionQuery = await app.request("/v1/extension-queries:stream", {
      headers: {
        authorization: `HuayiExtension ${"s".repeat(43)}`,
        "x-huayi-client-version": "1.0.0",
      },
      method: "POST",
    });
    expect(blockedExtensionQuery.status).toBe(403);
    const staleClient = await app.request("/v1/analyses:stream", {
      headers: { authorization: `HuayiExtension ${"s".repeat(43)}`, origin: extensionOrigin },
      method: "POST",
    });
    expect(staleClient.status).toBe(426);
    await expect(staleClient.json()).resolves.toMatchObject({
      error: { code: "client_upgrade_required" },
    });
    const blockedCreate = await app.request("/v1/learning-items", {
      body: "{}",
      headers: {
        cookie: "huayi_session=session-without-mutation-proof",
        "idempotency-key": "manual-1",
      },
      method: "POST",
    });
    expect(blockedCreate.status).toBe(403);
    const blockedPreferences = await app.request("/v1/account/preferences", {
      body: JSON.stringify({ dailyGoal: 5, timezone: "Asia/Shanghai" }),
      headers: { cookie: "huayi_session=session-without-mutation-proof" },
      method: "PATCH",
    });
    expect(blockedPreferences.status).toBe(403);
    const blockedWordUpsert = await app.request("/v1/words", {
      body: JSON.stringify({ headword: "run into" }),
      headers: {
        cookie: "huayi_session=session-without-mutation-proof",
        "idempotency-key": "word-upsert-1",
      },
      method: "POST",
    });
    expect(blockedWordUpsert.status).toBe(403);
    const blockedAdminWrite = await app.request(
      "/v1/admin/users/00000000-0000-0000-0000-000000000001/status",
      {
        body: JSON.stringify({ action: "disable" }),
        headers: {
          cookie: "huayi_session=session-without-mutation-proof",
          "idempotency-key": "admin-status-1",
        },
        method: "POST",
      },
    );
    expect(blockedAdminWrite.status).toBe(403);
  });

  it("leaves frequent scheduling to the production Supabase Cron adapter", async () => {
    const configuration = JSON.parse(
      await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    ) as { crons?: unknown };

    expect(configuration).not.toHaveProperty("crons");
  });
});

it("authenticates analysis with either a Web cookie or an Extension token", async () => {
  const policy = {
    extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
    minSupportedExtensionVersion: "1.0.0",
  };
  const identity = {
    authenticateExtension: vi.fn(async () => ({ userId: "extension-user" })),
    authenticateWebMutation: vi.fn(async () => ({ userId: "web-user" })),
    authenticateWebSession: vi.fn(async () => ({ userId: "web-user" })),
  };
  await expect(
    authenticateProductionPrincipalRequest(
      identity,
      {
        authorization: `HuayiExtension ${"s".repeat(43)}`,
        clientVersion: "1.0.0",
        origin: policy.extensionOrigin,
      },
      policy,
    ),
  ).resolves.toEqual({ kind: "extension", userId: "extension-user" });
  await expect(
    authenticateProductionPrincipalRequest(
      identity,
      {
        cookie: "huayi_session=web-session",
      },
      policy,
    ),
  ).resolves.toEqual({ kind: "web", userId: "web-user" });
  await expect(
    authenticateProductionAnalysisRequest(
      identity,
      {
        authorization: `HuayiExtension ${"s".repeat(43)}`,
        clientVersion: "1.0.0",
        origin: policy.extensionOrigin,
      },
      policy,
    ),
  ).resolves.toBe("extension-user");
  await expect(
    authenticateProductionAnalysisRequest(
      identity,
      {
        cookie: "other=x; huayi_session=web-session",
      },
      policy,
    ),
  ).resolves.toBe("web-user");
  expect(identity.authenticateExtension).toHaveBeenCalledWith("s".repeat(43));
  expect(identity.authenticateWebSession).toHaveBeenCalledWith("web-session");
  await expect(
    authenticateProductionAnalysisRequest(
      identity,
      {
        cookie: "huayi_session=web-session",
        method: "POST",
      },
      policy,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    authenticateProductionAnalysisRequest(
      identity,
      {
        cookie: "huayi_session=web-session",
        csrf: "csrf-token",
        method: "POST",
        origin: "https://app.huayi.example",
      },
      policy,
    ),
  ).resolves.toBe("web-user");
  await expect(
    authenticateProductionAnalysisRequest(
      identity,
      {
        cookie: "huayi_session=web-session",
        method: "DELETE",
      },
      policy,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
});
