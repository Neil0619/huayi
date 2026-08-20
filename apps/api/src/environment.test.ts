import { describe, expect, it } from "vitest";

import { parseApiEnvironment, readApiEnvironment } from "./environment.js";

describe("API security environment", () => {
  it("requires server-only origin and hashing configuration", () => {
    expect(
      parseApiEnvironment({
        HUAYI_API_ORIGIN: "https://api.huayi.example",
        HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
        CRON_SECRET: "cron-test-secret-at-least-32-characters",
        HUAYI_DATABASE_URL: "postgresql://app:secret@pooler.example:6543/postgres",
        HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
        HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
        HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
        HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
        HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
        HUAYI_SECRET_PEPPER: "a-secure-test-pepper-with-32-characters",
        HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
        HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
        HUAYI_WEB_ORIGIN: "https://app.huayi.example",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
        SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
        SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toMatchObject({
      HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
      HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
      HUAYI_WEB_ORIGIN: "https://app.huayi.example",
    });
    expect(() =>
      parseApiEnvironment({
        HUAYI_API_ORIGIN: "https://api.huayi.example",
        HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
        CRON_SECRET: "cron-test-secret-at-least-32-characters",
        HUAYI_DATABASE_URL: "postgresql://app:secret@pooler.example:6543/postgres",
        HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
        HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
        HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
        HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
        HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
        HUAYI_SECRET_PEPPER: "a-secure-test-pepper-with-32-characters",
        HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
        HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "9007199254740992.0.0",
        HUAYI_WEB_ORIGIN: "https://app.huayi.example",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
        SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
        SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow();
    expect(() =>
      parseApiEnvironment({
        HUAYI_API_ORIGIN: "https://api.huayi.example",
        HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
        CRON_SECRET: "cron-test-secret-at-least-32-characters",
        HUAYI_DATABASE_URL: "postgresql://app:secret@pooler.example:6543/postgres",
        HUAYI_DEEPSEEK_API_KEY: "too-short",
        HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "not-a-uuid",
        HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
        HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
        HUAYI_REFRESH_ENCRYPTION_KEY: "too-short",
        HUAYI_SECRET_PEPPER: "short",
        HUAYI_STORE_EXTENSION_ID: "invalid",
        HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0",
        HUAYI_WEB_ORIGIN: "https://app.huayi.example",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
        SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
        SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow();

    expect(
      readApiEnvironment({
        PATH: "/ignored/system/path",
        HUAYI_API_ORIGIN: "https://api.huayi.example",
        HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
        CRON_SECRET: "cron-test-secret-at-least-32-characters",
        HUAYI_DATABASE_URL: "postgresql://app:secret@pooler.example:6543/postgres",
        HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
        HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
        HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
        HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
        HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
        HUAYI_SECRET_PEPPER: "a-secure-test-pepper-with-32-characters",
        HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
        HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
        HUAYI_WEB_ORIGIN: "https://app.huayi.example",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
        SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
        SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toMatchObject({ HUAYI_WEB_ORIGIN: "https://app.huayi.example" });
  });
});
