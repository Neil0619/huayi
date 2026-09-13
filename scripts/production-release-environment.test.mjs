import assert from "node:assert/strict";
import test from "node:test";

import { buildProductionEnvironment } from "./production-release-environment.mjs";

const secrets = {
  databasePassword: "d".repeat(64),
  databaseCa: "-----BEGIN CERTIFICATE-----\n" + "a".repeat(256) + "\n-----END CERTIFICATE-----\n",
  deepseekApiKey: "sk-" + "d".repeat(40),
  refreshEncryptionKey: Buffer.alloc(32, 1).toString("base64url"),
  secretPepper: "p".repeat(43),
  cronSecret: "c".repeat(43),
  supabasePublishableKey: "sb_publishable_" + "p".repeat(30),
  supabaseServiceRoleKey: "s".repeat(100),
  resendNotificationKey: "re_" + "r".repeat(40),
};

const productionPriceIds = {
  HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "96f0345e-4020-4f71-a2ec-470ff33a3fed",
  HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "40f17bbd-6fb7-487f-bf84-402bf752f0e4",
  HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "13569e29-0352-4afe-b408-8abeee6c05ac",
  HUAYI_DEEPSEEK_20260910_OFF_PEAK_PRICE_VERSION_ID: "b1245b4c-c234-4abe-8197-6d02824f7421",
  HUAYI_DEEPSEEK_20260910_PEAK_PRICE_VERSION_ID: "9f2b46bf-d823-430e-a6fc-f1e24266ccad",
};

test("pins five distinct production price UUIDs without reusing acceptance or historical model rows", () => {
  const environment = buildProductionEnvironment(secrets);
  const prices = Object.fromEntries(
    Object.entries(environment.api).filter(([key]) => key.endsWith("_PRICE_VERSION_ID")),
  );
  assert.deepEqual(prices, productionPriceIds);
  assert.equal(new Set(Object.values(prices)).size, 5);
  const previousOrAcceptanceIds = new Set([
    // Historical production deepseek-v4-flash rows.
    "213149df-94fe-4794-9490-fd4741a15f38",
    "26b376eb-f649-4a00-901f-a5492e3fd7c9",
    "72e72840-2798-4f4e-a503-7f1f7e825f63",
    // Historical and current Hosted acceptance rows belong to a different database.
    "8a7c5397-dbba-4e28-bc0d-107c4d04c3c3",
    "dad0deb1-cbdc-4311-b3ad-b492c7ece757",
    "e4479ddf-f4da-4a75-825a-2b25c1a145cf",
    "c2da2e72-df3e-4367-9f44-893d573b4536",
    "88399b8b-9762-465e-9338-4b37727bd272",
    "852532f1-28a3-4a0b-8b4c-8faf37fe3002",
    "7717feb2-9a67-46d9-9cba-ccf3765e04d1",
    "aa7bbda9-3270-4df5-a70c-77d4a704add0",
  ]);
  for (const id of Object.values(prices)) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(previousOrAcceptanceIds.has(id), false);
  }
  assert.deepEqual(buildProductionEnvironment({ ...secrets }), environment);
  assert.ok(Object.isFrozen(environment));
  assert.ok(Object.isFrozen(environment.api));
  assert.ok(Object.isFrozen(environment.web));
});

test("production environment has independent origins, database login, mail identity and no client secrets", () => {
  const value = buildProductionEnvironment(secrets);
  assert.deepEqual(value.web, {
    VITE_API_ORIGIN: "https://api.seen-said.cn",
    VITE_DEPLOYMENT_ENVIRONMENT: "production",
  });
  assert.equal(value.api.HUAYI_API_ORIGIN, value.web.VITE_API_ORIGIN);
  assert.equal(value.api.HUAYI_WEB_ORIGIN, "https://app.seen-said.cn");
  assert.equal(value.api.HUAYI_DEPLOYMENT_ENVIRONMENT, "production");
  assert.equal(value.api.HUAYI_SECURITY_NOTIFICATION_REPLY_TO, "niu0619@gmail.com");
  assert.equal(value.api.HUAYI_SECURITY_NOTIFICATION_FROM, "语见 <security@notify.seen-said.cn>");
  assert.equal(value.api.HUAYI_ACCOUNT_EXPORT_BUCKET, "account-exports-production");
  assert.equal(value.api.SUPABASE_URL, "https://pxqqgxfumovegbcxnmzb.supabase.co");
  const database = new URL(value.api.HUAYI_DATABASE_URL);
  assert.equal(database.username, "huayi_production_login.pxqqgxfumovegbcxnmzb");
  assert.equal(database.password, secrets.databasePassword);
  assert.equal(database.searchParams.get("sslmode"), "verify-full");
  assert.equal(database.hostname, "aws-0-ap-southeast-1.pooler.supabase.com");
  assert.equal(
    Buffer.from(value.api.HUAYI_DATABASE_TLS_CA_BASE64, "base64").toString(),
    secrets.databaseCa,
  );
  for (const [key, name] of Object.entries({
    HUAYI_DEEPSEEK_API_KEY: "deepseekApiKey",
    HUAYI_REFRESH_ENCRYPTION_KEY: "refreshEncryptionKey",
    HUAYI_SECRET_PEPPER: "secretPepper",
    CRON_SECRET: "cronSecret",
    SUPABASE_PUBLISHABLE_KEY: "supabasePublishableKey",
    SUPABASE_SERVICE_ROLE_KEY: "supabaseServiceRoleKey",
    HUAYI_RESEND_API_KEY: "resendNotificationKey",
  })) {
    assert.equal(value.api[key], secrets[name]);
  }
  for (const secret of Object.values(secrets)) {
    assert.equal(JSON.stringify(value.web).includes(secret), false);
  }
  assert.equal(
    Object.keys(value.api).some((key) => key.startsWith("VERCEL_")),
    false,
  );
  assert.equal(JSON.stringify(value).includes("acceptance"), false);
});

test("environment construction rejects missing, line-broken or mistaken credentials without echoing them", () => {
  for (const name of Object.keys(secrets)) {
    for (const invalid of [undefined, "", "secret\nother", 12]) {
      assert.throws(() => buildProductionEnvironment({ ...secrets, [name]: invalid }), {
        message: "Production runtime configuration is invalid.",
      });
    }
  }
  assert.throws(() =>
    buildProductionEnvironment({ ...secrets, deepseekApiKey: "wrong".repeat(12) }),
  );
  assert.throws(() =>
    buildProductionEnvironment({ ...secrets, resendNotificationKey: secrets.deepseekApiKey }),
  );
});
