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
