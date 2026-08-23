import { describe, expect, it } from "vitest";

import { parseApiEnvironment, readApiEnvironment } from "./environment.js";

const databaseTlsCaBase64 = Buffer.from(
  "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----\n",
).toString("base64");

function validHostedEnvironment() {
  return {
    CRON_SECRET: "cron-test-secret-at-least-32-characters",
    HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
    HUAYI_API_ORIGIN: "https://api.huayi.example",
    HUAYI_DATABASE_TLS_CA_BASE64: databaseTlsCaBase64,
    HUAYI_DATABASE_URL:
      "postgresql://app.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
    HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
    HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
    HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
    HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
    HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
    HUAYI_RESEND_API_KEY: "re_test-only-not-a-real-secret",
    HUAYI_SECRET_PEPPER: "a-secure-test-pepper-with-32-characters",
    HUAYI_SECURITY_NOTIFICATION_FROM: "语见 <security@notify.example.test>",
    HUAYI_SECURITY_NOTIFICATION_MODE: "resend",
    HUAYI_SECURITY_NOTIFICATION_REPLY_TO: "support@example.test",
    HUAYI_STORE_EXTENSION_CAPABILITY: "enabled",
    HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
    HUAYI_WEB_ORIGIN: "https://app.huayi.example",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  };
}

describe("API security environment", () => {
  it("keeps Google authentication fail-closed unless explicitly enabled", () => {
    expect(parseApiEnvironment(validHostedEnvironment())).not.toHaveProperty(
      "HUAYI_GOOGLE_AUTHENTICATION",
    );
    expect(
      parseApiEnvironment({
        ...validHostedEnvironment(),
        HUAYI_GOOGLE_AUTHENTICATION: "enabled",
      }),
    ).toMatchObject({ HUAYI_GOOGLE_AUTHENTICATION: "enabled" });
    expect(() =>
      parseApiEnvironment({
        ...validHostedEnvironment(),
        HUAYI_GOOGLE_AUTHENTICATION: "disabled",
      }),
    ).toThrow();
  });

  it("requires an explicit Store capability and disables Store without an Extension ID", () => {
    const enabled = validHostedEnvironment();
    const disabled: Record<string, string | undefined> = {
      ...enabled,
      HUAYI_STORE_EXTENSION_CAPABILITY: "disabled",
    };
    delete disabled.HUAYI_STORE_EXTENSION_ID;

    expect(parseApiEnvironment(disabled)).toMatchObject({
      HUAYI_STORE_EXTENSION_CAPABILITY: "disabled",
    });
    expect(parseApiEnvironment(disabled)).not.toHaveProperty("HUAYI_STORE_EXTENSION_ID");
    expect(() =>
      parseApiEnvironment({ ...enabled, HUAYI_STORE_EXTENSION_CAPABILITY: undefined }),
    ).toThrow();
    expect(() =>
      parseApiEnvironment({ ...enabled, HUAYI_STORE_EXTENSION_CAPABILITY: "disabled" }),
    ).toThrow();
    expect(() =>
      parseApiEnvironment({
        ...enabled,
        HUAYI_STORE_EXTENSION_CAPABILITY: "enabled",
        HUAYI_STORE_EXTENSION_ID: "invalid",
      }),
    ).toThrow();
  });

  it("requires server-only origin and hashing configuration", () => {
    expect(parseApiEnvironment(validHostedEnvironment())).toMatchObject({
      HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
      HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
      HUAYI_SECURITY_NOTIFICATION_MODE: "resend",
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
        HUAYI_RESEND_API_KEY: "invalid",
        HUAYI_SECRET_PEPPER: "short",
        HUAYI_SECURITY_NOTIFICATION_FROM: "invalid",
        HUAYI_SECURITY_NOTIFICATION_MODE: "resend",
        HUAYI_SECURITY_NOTIFICATION_REPLY_TO: "invalid",
        HUAYI_STORE_EXTENSION_ID: "invalid",
        HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0",
        HUAYI_WEB_ORIGIN: "https://app.huayi.example",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
        SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
        SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toThrow();

    expect(
      readApiEnvironment({ PATH: "/ignored/system/path", ...validHostedEnvironment() }),
    ).toMatchObject({ HUAYI_WEB_ORIGIN: "https://app.huayi.example" });
  });

  it("allows notification delivery to be disabled only for the fixed local acceptance origin", () => {
    const common = {
      CRON_SECRET: "cron-test-secret-at-least-32-characters",
      HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports",
      HUAYI_DATABASE_URL: "postgresql://huayi_acceptance_login:secret@127.0.0.1:54322/postgres",
      HUAYI_DEEPSEEK_API_KEY: "deepseek-test-key-at-least-20-characters",
      HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000001",
      HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000002",
      HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "10000000-0000-4000-8000-000000000003",
      HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
      HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
      HUAYI_SECRET_PEPPER: "a-secure-test-pepper-with-32-characters",
      HUAYI_SECURITY_NOTIFICATION_MODE: "disabled-local-acceptance",
      HUAYI_STORE_EXTENSION_CAPABILITY: "enabled",
      HUAYI_STORE_EXTENSION_ID: "a".repeat(32),
      HUAYI_WEB_ORIGIN: "https://app.acceptance.localhost:8443",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
      SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_test-value",
      SUPABASE_URL: "https://supabase.acceptance.localhost:8445",
    };
    expect(
      parseApiEnvironment({
        ...common,
        HUAYI_API_ORIGIN: "https://api.acceptance.localhost:8444",
      }),
    ).toMatchObject({ HUAYI_SECURITY_NOTIFICATION_MODE: "disabled-local-acceptance" });
    expect(() =>
      parseApiEnvironment({
        ...common,
        HUAYI_API_ORIGIN: "https://api.huayi.example",
      }),
    ).toThrow();
    expect(() =>
      parseApiEnvironment({
        ...common,
        HUAYI_API_ORIGIN: "https://api.acceptance.localhost:8444",
        HUAYI_DATABASE_URL: "postgresql://other:secret@127.0.0.1:54322/postgres",
      }),
    ).toThrow();
  });

  it("rejects non-exact HTTPS deployment origins before startup", () => {
    const invalidOrigins = [
      ["HUAYI_API_ORIGIN", "http://api.huayi.example"],
      ["HUAYI_API_ORIGIN", "https://operator:secret@api.huayi.example"],
      ["HUAYI_API_ORIGIN", "https://api.huayi.example/v1"],
      ["HUAYI_API_ORIGIN", "https://api.huayi.example?environment=acceptance"],
      ["HUAYI_API_ORIGIN", "https://api.huayi.example#acceptance"],
      ["HUAYI_API_ORIGIN", "https://api.huayi.example/"],
      ["HUAYI_WEB_ORIGIN", "http://app.huayi.example"],
      ["HUAYI_WEB_ORIGIN", "https://app.huayi.example/workspace"],
      ["SUPABASE_URL", "http://project.supabase.co"],
      ["SUPABASE_URL", "https://project.supabase.co/auth/v1"],
    ] as const;

    for (const [name, value] of invalidOrigins) {
      expect(() => parseApiEnvironment({ ...validHostedEnvironment(), [name]: value })).toThrow();
    }
    expect(() =>
      parseApiEnvironment({
        ...validHostedEnvironment(),
        HUAYI_WEB_ORIGIN: "https://api.huayi.example",
      }),
    ).toThrow();
  });

  it("requires a verify-full Supabase transaction pooler URL and bounded CA for hosted mode", () => {
    const invalidDatabaseUrls = [
      "postgresql://app.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
      "postgresql://app.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require",
      "postgresql://app.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full",
      "postgresql://app:secret@database.example:6543/postgres?sslmode=verify-full",
    ];
    for (const databaseUrl of invalidDatabaseUrls) {
      expect(() =>
        parseApiEnvironment({ ...validHostedEnvironment(), HUAYI_DATABASE_URL: databaseUrl }),
      ).toThrow();
    }
    for (const ca of ["", "not-base64", Buffer.alloc(20_000).toString("base64")]) {
      expect(() =>
        parseApiEnvironment({ ...validHostedEnvironment(), HUAYI_DATABASE_TLS_CA_BASE64: ca }),
      ).toThrow();
    }
    expect(() =>
      parseApiEnvironment({
        ...validHostedEnvironment(),
        SUPABASE_URL: "https://differentprojectref.supabase.co",
      }),
    ).toThrow();
  });
});
