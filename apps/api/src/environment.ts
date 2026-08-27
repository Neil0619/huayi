import { isSafeExtensionVersion } from "@huayi/cloud-contracts";
import { z } from "zod";

const extensionVersionSchema = z
  .string()
  .refine(isSafeExtensionVersion, "Expected a three-part safe-integer Extension version.");

function isExactHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

const exactHttpsOriginSchema = z
  .string()
  .refine(isExactHttpsOrigin, "Expected an exact HTTPS origin without credentials or a path.");

function isHostedDatabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "postgresql:" &&
      /^[a-z_][a-z0-9_]*\.[a-z]{20}$/u.test(parsed.username) &&
      parsed.password.length > 0 &&
      /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(parsed.hostname) &&
      parsed.port === "6543" &&
      parsed.pathname === "/postgres" &&
      parsed.searchParams.size === 1 &&
      parsed.searchParams.get("sslmode") === "verify-full" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function isLocalAcceptanceDatabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "postgresql:" &&
      parsed.username === "huayi_acceptance_login" &&
      parsed.password.length > 0 &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "54322" &&
      parsed.pathname === "/postgres" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function isBoundedDatabaseCa(value: string): boolean {
  if (value.length < 32 || value.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    return false;
  }
  const certificate = Buffer.from(value, "base64").toString("utf8");
  return (
    certificate.startsWith("-----BEGIN CERTIFICATE-----\n") &&
    certificate.trimEnd().endsWith("-----END CERTIFICATE-----")
  );
}

const hostedDatabaseUrlSchema = z
  .string()
  .refine(isHostedDatabaseUrl, "Expected a verify-full Supabase transaction pooler URL.");

const databaseCaSchema = z
  .string()
  .refine(isBoundedDatabaseCa, "Expected one bounded base64-encoded database CA certificate.");

const localAcceptanceDatabaseUrlSchema = z
  .string()
  .refine(isLocalAcceptanceDatabaseUrl, "Expected the fixed local acceptance database URL.");

const baseEnvironmentShape = {
  HUAYI_API_ORIGIN: exactHttpsOriginSchema,
  HUAYI_DATABASE_URL: z.string().startsWith("postgresql://").min(32),
  HUAYI_DEEPSEEK_API_KEY: z.string().min(20),
  HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: z.string().uuid(),
  HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: z.string().uuid(),
  HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: z.string().uuid(),
  HUAYI_REFRESH_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64url").byteLength === 32, {
      message: "Expected a base64url-encoded 256-bit encryption key.",
    }),
  HUAYI_SECRET_PEPPER: z.string().min(32),
  HUAYI_GOOGLE_AUTHENTICATION: z.literal("enabled").optional(),
  HUAYI_STORE_EXTENSION_CAPABILITY: z.enum(["enabled", "disabled"]),
  HUAYI_STORE_EXTENSION_ID: z
    .string()
    .regex(/^[a-p]{32}$/u)
    .optional(),
  HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: extensionVersionSchema,
  HUAYI_ACCOUNT_EXPORT_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,62}$/u),
  CRON_SECRET: z.string().min(32).max(512),
  HUAYI_WEB_ORIGIN: exactHttpsOriginSchema,
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_URL: exactHttpsOriginSchema,
  VERCEL_DEPLOYMENT_ID: z
    .string()
    .regex(/^dpl_[A-Za-z0-9_-]{3,128}$/u)
    .optional(),
  VERCEL_GIT_COMMIT_SHA: z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .optional(),
} as const;

const resendEnvironmentSchema = z
  .object({
    ...baseEnvironmentShape,
    HUAYI_DATABASE_TLS_CA_BASE64: databaseCaSchema,
    HUAYI_DATABASE_URL: hostedDatabaseUrlSchema,
    HUAYI_RESEND_API_KEY: z.string().startsWith("re_").min(20).max(512),
    HUAYI_SECURITY_NOTIFICATION_FROM: z
      .string()
      .min(8)
      .max(254)
      .regex(/^语见 <[^<>\s@]+@[^<>\s@]+>$/u),
    HUAYI_SECURITY_NOTIFICATION_MODE: z.literal("resend"),
    HUAYI_SECURITY_NOTIFICATION_REPLY_TO: z.email(),
  })
  .strict();

const localAcceptanceEnvironmentSchema = z
  .object({
    ...baseEnvironmentShape,
    HUAYI_DATABASE_URL: localAcceptanceDatabaseUrlSchema,
    HUAYI_SECURITY_NOTIFICATION_MODE: z.literal("disabled-local-acceptance"),
  })
  .strict()
  .refine(
    (environment) =>
      environment.HUAYI_API_ORIGIN === "https://api.acceptance.localhost:8444" &&
      environment.HUAYI_WEB_ORIGIN === "https://app.acceptance.localhost:8443" &&
      environment.SUPABASE_URL === "https://supabase.acceptance.localhost:8445",
    "Notification delivery can be disabled only in local acceptance.",
  );

const apiEnvironmentSchema = z
  .union([resendEnvironmentSchema, localAcceptanceEnvironmentSchema])
  .refine(
    (environment) =>
      environment.HUAYI_STORE_EXTENSION_CAPABILITY === "enabled"
        ? environment.HUAYI_STORE_EXTENSION_ID !== undefined
        : environment.HUAYI_STORE_EXTENSION_ID === undefined,
    "Store Extension ID must be present only when the Store capability is enabled.",
  )
  .refine(
    (environment) => environment.HUAYI_API_ORIGIN !== environment.HUAYI_WEB_ORIGIN,
    "API and Web origins must be different.",
  )
  .refine(
    (environment) =>
      (environment.VERCEL_DEPLOYMENT_ID === undefined) ===
      (environment.VERCEL_GIT_COMMIT_SHA === undefined),
    "Vercel deployment identity must be complete.",
  )
  .refine(
    (environment) =>
      new Set([
        environment.HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID,
        environment.HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID,
        environment.HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID,
      ]).size === 3,
    "DeepSeek price version ids must be unique.",
  )
  .refine((environment) => {
    if (environment.HUAYI_SECURITY_NOTIFICATION_MODE !== "resend") return true;
    const databaseUsername = new URL(environment.HUAYI_DATABASE_URL).username;
    const projectRef = databaseUsername.split(".")[1];
    return new URL(environment.SUPABASE_URL).hostname === `${projectRef}.supabase.co`;
  }, "Hosted database and Supabase API must use the same project reference.");

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function parseApiEnvironment(
  environment: Record<string, string | undefined>,
): ApiEnvironment {
  return apiEnvironmentSchema.parse(environment);
}

export function readApiEnvironment(
  environment: Record<string, string | undefined>,
): ApiEnvironment {
  return parseApiEnvironment({
    HUAYI_API_ORIGIN: environment.HUAYI_API_ORIGIN,
    HUAYI_DATABASE_URL: environment.HUAYI_DATABASE_URL,
    ...(environment.HUAYI_SECURITY_NOTIFICATION_MODE === "resend"
      ? { HUAYI_DATABASE_TLS_CA_BASE64: environment.HUAYI_DATABASE_TLS_CA_BASE64 }
      : {}),
    HUAYI_DEEPSEEK_API_KEY: environment.HUAYI_DEEPSEEK_API_KEY,
    HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: environment.HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID,
    HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: environment.HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID,
    HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: environment.HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID,
    HUAYI_REFRESH_ENCRYPTION_KEY: environment.HUAYI_REFRESH_ENCRYPTION_KEY,
    HUAYI_SECRET_PEPPER: environment.HUAYI_SECRET_PEPPER,
    ...(environment.HUAYI_GOOGLE_AUTHENTICATION === undefined
      ? {}
      : { HUAYI_GOOGLE_AUTHENTICATION: environment.HUAYI_GOOGLE_AUTHENTICATION }),
    HUAYI_SECURITY_NOTIFICATION_MODE: environment.HUAYI_SECURITY_NOTIFICATION_MODE,
    ...(environment.HUAYI_SECURITY_NOTIFICATION_MODE === "resend"
      ? {
          HUAYI_RESEND_API_KEY: environment.HUAYI_RESEND_API_KEY,
          HUAYI_SECURITY_NOTIFICATION_FROM: environment.HUAYI_SECURITY_NOTIFICATION_FROM,
          HUAYI_SECURITY_NOTIFICATION_REPLY_TO: environment.HUAYI_SECURITY_NOTIFICATION_REPLY_TO,
        }
      : {}),
    HUAYI_STORE_EXTENSION_CAPABILITY: environment.HUAYI_STORE_EXTENSION_CAPABILITY,
    ...(environment.HUAYI_STORE_EXTENSION_ID === undefined
      ? {}
      : { HUAYI_STORE_EXTENSION_ID: environment.HUAYI_STORE_EXTENSION_ID }),
    HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: environment.HUAYI_MIN_SUPPORTED_EXTENSION_VERSION,
    HUAYI_ACCOUNT_EXPORT_BUCKET: environment.HUAYI_ACCOUNT_EXPORT_BUCKET,
    CRON_SECRET: environment.CRON_SECRET,
    HUAYI_WEB_ORIGIN: environment.HUAYI_WEB_ORIGIN,
    SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: environment.SUPABASE_URL,
    ...(environment.VERCEL_DEPLOYMENT_ID === undefined
      ? {}
      : { VERCEL_DEPLOYMENT_ID: environment.VERCEL_DEPLOYMENT_ID }),
    ...(environment.VERCEL_GIT_COMMIT_SHA === undefined
      ? {}
      : { VERCEL_GIT_COMMIT_SHA: environment.VERCEL_GIT_COMMIT_SHA }),
  });
}
