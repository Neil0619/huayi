import assert from "node:assert/strict";
import { test } from "node:test";

import { createViteConfiguration } from "../apps/web/vite.config.ts";
import {
  renderHostedDeploymentPlan,
  runHostedDeploymentCli,
  verifyHostedDeploymentEnvironment,
} from "./acceptance-hosted-deployment.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";

function validHostedEnvironment() {
  return {
    CRON_SECRET: "cron-secret-at-least-thirty-two-characters",
    HUAYI_ACCOUNT_EXPORT_BUCKET: "account-exports-acceptance",
    HUAYI_API_ORIGIN: "https://api.acceptance.seen-said.cn",
    HUAYI_DATABASE_TLS_CA_BASE64: Buffer.from(
      "-----BEGIN CERTIFICATE-----\ntest-hosted-ca-certificate-material\n-----END CERTIFICATE-----\n",
    ).toString("base64"),
    HUAYI_DATABASE_URL:
      "postgresql://huayi_hosted_acceptance_login.kpadiulxkgckskcfydry:application-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    HUAYI_DEEPSEEK_API_KEY: "deepseek-hosted-test-key",
    HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID: "8a7c5397-dbba-4e28-bc0d-107c4d04c3c3",
    HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID: "dad0deb1-cbdc-4311-b3ad-b492c7ece757",
    HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID: "e4479ddf-f4da-4a75-825a-2b25c1a145cf",
    HUAYI_MIN_SUPPORTED_EXTENSION_VERSION: "1.0.0",
    HUAYI_REFRESH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    HUAYI_RESEND_API_KEY: "re_hosted-test-not-real",
    HUAYI_SECRET_PEPPER: "hosted-secret-pepper-at-least-32-characters",
    HUAYI_SECURITY_NOTIFICATION_FROM: "语见 <security@notify.acceptance.seen-said.cn>",
    HUAYI_SECURITY_NOTIFICATION_MODE: "resend",
    HUAYI_SECURITY_NOTIFICATION_REPLY_TO: "support@example.test",
    HUAYI_STORE_EXTENSION_CAPABILITY: "disabled",
    HUAYI_WEB_ORIGIN: "https://app.acceptance.seen-said.cn",
    SUPABASE_PUBLISHABLE_KEY: "publishable-hosted-test-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-hosted-test-key",
    SUPABASE_URL: "https://kpadiulxkgckskcfydry.supabase.co",
  };
}

test("hosted deployment plan is complete, deterministic, and secret independent", () => {
  const plan = renderHostedDeploymentPlan();
  for (const expected of [
    "seen-said-acceptance-api | apps/api | hono | sin1 | Fluid | 120s",
    "seen-said-acceptance-web | apps/web | vite | pnpm build | dist",
    "HUAYI_DATABASE_TLS_CA_BASE64",
    "HUAYI_STORE_EXTENSION_CAPABILITY",
    "Confirmed deployment decisions (values are not printed):",
    "hosted DeepSeek key is available and small real acceptance charges are approved",
    "https://api.acceptance.seen-said.cn/v1/auth/callback",
    "https://api.acceptance.seen-said.cn/v1/auth/password/callback",
    "https://api.acceptance.seen-said.cn/v1/auth/password/recovery/confirm",
    "https://api.acceptance.seen-said.cn/v1/auth/reauthenticate/google/callback",
    "https://api.acceptance.seen-said.cn/v1/account/sign-in-methods/google:callback",
    "smtp.resend.com:465 | resend",
    "five Supabase Cron jobs",
    "FirstOperatorBootstrap invitation",
  ]) {
    assert.match(plan, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(plan, /application-password|re_hosted-test|deepseek-hosted-test/u);
  assert.doesNotMatch(plan, /HUAYI_STORE_EXTENSION_ID/u);
});

test("hosted deployment environment verifier reuses the production schema and fixed contract", () => {
  assert.equal(verifyHostedDeploymentEnvironment(validHostedEnvironment()), true);
  for (const mutation of [
    { HUAYI_API_ORIGIN: "https://api.huayi.example" },
    {
      HUAYI_DATABASE_URL:
        "postgresql://other.kpadiulxkgckskcfydry:application-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    },
    { HUAYI_STORE_EXTENSION_CAPABILITY: "enabled" },
    {
      HUAYI_STORE_EXTENSION_CAPABILITY: "disabled",
      HUAYI_STORE_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
    },
  ]) {
    assert.throws(() =>
      verifyHostedDeploymentEnvironment({ ...validHostedEnvironment(), ...mutation }),
    );
  }
});

test("hosted deployment CLI never reflects invalid environment values", async () => {
  let stdout = "";
  let stderr = "";
  const secret = "do-not-reflect-this-secret";
  const code = await runHostedDeploymentCli({
    arguments_: ["--verify-environment"],
    environment: { ...validHostedEnvironment(), HUAYI_SECRET_PEPPER: secret },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "Hosted acceptance deployment environment verification failed.\n");
  assert.doesNotMatch(stderr, new RegExp(secret, "u"));
});

test("Vite injects a full Vercel commit only for a valid hosted acceptance build", () => {
  assert.deepEqual(
    createViteConfiguration({
      VERCEL_GIT_COMMIT_SHA: commit,
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
    }).define,
    { HUAYI_DEPLOYMENT_COMMIT: JSON.stringify(commit) },
  );
  assert.throws(() =>
    createViteConfiguration({ VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance" }),
  );
  assert.deepEqual(createViteConfiguration({ VERCEL_GIT_COMMIT_SHA: commit }).define, {
    HUAYI_DEPLOYMENT_COMMIT: JSON.stringify(""),
  });
});
