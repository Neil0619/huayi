import { readFile, readdir } from "node:fs/promises";

import { afterEach, expect, it, vi } from "vitest";

import { createHealthApp } from "./health-app.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubLocalAcceptanceEnvironment(): void {
  const environment = {
    CRON_SECRET: "cron-test-secret-at-least-32-characters",
    HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
    HUAYI_API_ORIGIN: "https://api.acceptance.localhost:8444",
    HUAYI_DATABASE_URL:
      "postgresql://huayi_acceptance_login:test-password@127.0.0.1:54322/postgres",
    HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
    HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
    HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
    HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
    HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
    HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    HUAYI_SECRET_PEPPER: "production-test-pepper-at-least-32-characters",
    HUAYI_SECURITY_NOTIFICATION_MODE: "disabled-local-acceptance",
    HUAYI_STORE_EXTENSION_CAPABILITY: "disabled",
    HUAYI_WEB_ORIGIN: "https://app.acceptance.localhost:8443",
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-key-at-least-20-characters",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key-at-least-20-characters",
    SUPABASE_URL: "https://supabase.acceptance.localhost:8445",
  } as const;

  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
  vi.stubEnv("HUAYI_STORE_EXTENSION_ID", undefined);
}

it("exposes the service health contract", async () => {
  const server = createHealthApp();
  const response = await server.request("/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ service: "huayi-cloud-api", status: "ok" });
});

it("keeps Vercel auto-discovery on the production server entrypoint", async () => {
  const recognizedEntrypoint = /^(?:app|index|server)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u;
  const rootCandidates = (await readdir(new URL("../", import.meta.url)))
    .filter((name) => recognizedEntrypoint.test(name))
    .map((name) => name);
  const sourceCandidates = (await readdir(new URL("./", import.meta.url)))
    .filter((name) => recognizedEntrypoint.test(name))
    .map((name) => `src/${name}`);

  expect([...rootCandidates, ...sourceCandidates]).toEqual(["src/server.ts"]);

  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  expect(source).toMatch(/^import \{ Hono \} from "hono";$/mu);

  stubLocalAcceptanceEnvironment();
  const productionEntrypoint = await import("./server.js");

  expect(productionEntrypoint.default).toBe(productionEntrypoint.app);
  expect(typeof productionEntrypoint.default.fetch).toBe("function");
  const response = await productionEntrypoint.default.request("/health");
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ service: "huayi-cloud-api", status: "ok" });
});

it("projects schema-validated commands across Vercel's Hono compiler boundary", async () => {
  const source = await readFile(new URL("./cloud-foundation-app.ts", import.meta.url), "utf8");

  expect(source).not.toContain("signInWithPassword(input)");
  expect(source).not.toContain("createExtensionPairing(input)");
  expect(source).toContain("signInWithPassword({");
  expect(source).toContain("createExtensionPairing({");
});
