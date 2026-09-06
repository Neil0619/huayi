const invalid = () => new Error("Production runtime configuration is invalid.");

export function buildProductionEnvironment(secrets) {
  try {
    const names = [
      "databasePassword",
      "databaseCa",
      "deepseekApiKey",
      "refreshEncryptionKey",
      "secretPepper",
      "cronSecret",
      "supabasePublishableKey",
      "supabaseServiceRoleKey",
      "resendNotificationKey",
    ];
    if (secrets === null || typeof secrets !== "object") throw invalid();
    for (const name of names) {
      const value = secrets[name];
      if (
        typeof value !== "string" ||
        value.length < 20 ||
        value.length > 16384 ||
        value.includes("\0")
      )
        throw invalid();
      if (name !== "databaseCa" && /[\r\n]/u.test(value)) throw invalid();
    }
    if (
      !/^[A-Za-z0-9_-]{64}$/u.test(secrets.databasePassword) ||
      !/^sk-\S+$/u.test(secrets.deepseekApiKey) ||
      !/^re_\S+$/u.test(secrets.resendNotificationKey) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(secrets.refreshEncryptionKey) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(secrets.secretPepper) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(secrets.cronSecret) ||
      !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/u.test(
        secrets.databaseCa,
      )
    )
      throw invalid();
    return Object.freeze({
      api: Object.freeze({
        HUAYI_DEPLOYMENT_ENVIRONMENT: "production",
        HUAYI_API_ORIGIN: "https://api.seen-said.cn",
        HUAYI_WEB_ORIGIN: "https://app.seen-said.cn",
        HUAYI_DATABASE_URL: `postgresql://huayi_production_login.pxqqgxfumovegbcxnmzb:${secrets.databasePassword}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
        HUAYI_DATABASE_TLS_CA_BASE64: Buffer.from(secrets.databaseCa).toString("base64"),
        HUAYI_DEEPSEEK_API_KEY: secrets.deepseekApiKey,
        HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "213149df-94fe-4794-9490-fd4741a15f38",
        HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "26b376eb-f649-4a00-901f-a5492e3fd7c9",
        HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "72e72840-2798-4f4e-a503-7f1f7e825f63",
        HUAYI_REFRESH_ENCRYPTION_KEY: secrets.refreshEncryptionKey,
        HUAYI_SECRET_PEPPER: secrets.secretPepper,
        CRON_SECRET: secrets.cronSecret,
        HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports-production",
        HUAYI_STORE_EXTENSION_CAPABILITY: "enabled",
        HUAYI_STORE_EXTENSION_ID: "enlolhfodncfnleiihkjanhmnfbgeggh",
        HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
        HUAYI_RESEND_API_KEY: secrets.resendNotificationKey,
        HUAYI_SECURITY_NOTIFICATION_MODE: "resend",
        HUAYI_SECURITY_NOTIFICATION_FROM: "语见 <security@notify.seen-said.cn>",
        HUAYI_SECURITY_NOTIFICATION_REPLY_TO: "niu0619@gmail.com",
        SUPABASE_URL: "https://pxqqgxfumovegbcxnmzb.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: secrets.supabasePublishableKey,
        SUPABASE_SERVICE_ROLE_KEY: secrets.supabaseServiceRoleKey,
      }),
      web: Object.freeze({
        VITE_API_ORIGIN: "https://api.seen-said.cn",
        VITE_DEPLOYMENT_ENVIRONMENT: "production",
      }),
    });
  } catch {
    throw invalid();
  }
}
