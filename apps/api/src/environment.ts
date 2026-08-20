import { isSafeExtensionVersion } from "@huayi/cloud-contracts";
import { z } from "zod";

const extensionVersionSchema = z
  .string()
  .refine(isSafeExtensionVersion, "Expected a three-part safe-integer Extension version.");

const apiEnvironmentSchema = z
  .object({
    HUAYI_API_ORIGIN: z.url(),
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
    HUAYI_STORE_EXTENSION_ID: z.string().regex(/^[a-p]{32}$/u),
    HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: extensionVersionSchema,
    HUAYI_ACCOUNT_EXPORT_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,62}$/u),
    CRON_SECRET: z.string().min(32),
    HUAYI_WEB_ORIGIN: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    SUPABASE_URL: z.url(),
  })
  .strict()
  .refine(
    (environment) =>
      new Set([
        environment.HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID,
        environment.HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID,
        environment.HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID,
      ]).size === 3,
    "DeepSeek price version ids must be unique.",
  );

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
    HUAYI_DEEPSEEK_API_KEY: environment.HUAYI_DEEPSEEK_API_KEY,
    HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: environment.HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID,
    HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: environment.HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID,
    HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: environment.HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID,
    HUAYI_REFRESH_ENCRYPTION_KEY: environment.HUAYI_REFRESH_ENCRYPTION_KEY,
    HUAYI_SECRET_PEPPER: environment.HUAYI_SECRET_PEPPER,
    HUAYI_STORE_EXTENSION_ID: environment.HUAYI_STORE_EXTENSION_ID,
    HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: environment.HUAYI_MIN_SUPPORTED_EXTENSION_VERSION,
    HUAYI_ACCOUNT_EXPORT_BUCKET: environment.HUAYI_ACCOUNT_EXPORT_BUCKET,
    CRON_SECRET: environment.CRON_SECRET,
    HUAYI_WEB_ORIGIN: environment.HUAYI_WEB_ORIGIN,
    SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: environment.SUPABASE_URL,
  });
}
