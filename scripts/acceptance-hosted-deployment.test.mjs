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
  const opaqueFlowGlob = "?".repeat(43);
  for (const expected of [
    "Hosted acceptance current action ledger (zero network / zero write)",
    "seen-said-acceptance-api | apps/api | hono | sin1 | Fluid | 120s",
    "seen-said-acceptance-web | apps/web | vite | pnpm build:vercel | dist",
    "API and Web Git deployment both disable every branch",
    "First Operator is completed and the post-completion verifier passed; do not rerun foundation bootstrap, migration 0012/0013, or BootstrapInvitation",
    "The only ordinary invitation has already submitted password registration; do not create or revoke another invitation or delete its bound Auth user",
    "Hosted Email OTP length was corrected only from 8 to 6 and independently reloaded; expiration remains 3600 and no new email has been sent",
    "Remote migration head remains 13; candidate migration 0014 and the token-only resend route are pending review, deployment, and explicit approval",
    "Current API latest is Ready deployment 6QeRbqxgA88cFXggKekkr2axH9JM at source 4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
    "Current Web latest is Ready deployment V3NzjTYXtH7fb3WC2P6hpWR1twhb at source 9b0860a91940e4f78968b3882af91ef5bf923b8a",
    "Cloud workspace redesign candidate 524a55b35dadfd1e8bd1ef89b0abc2baadf69066 was deployed only through the reviewed arm and followed by disarm d6d901c",
    "Phase 78 API-only arm 4f1ce4a458fe138aeee6fb455b2dcc398a55555a produced only deployment 6QeRbqxgA88cFXggKekkr2axH9JM; immediate disarm 020e21efa13bafb795d70a369e4512e76c7f7ab6 produced zero additional deployments",
    "Phase 80 Web-only arm 9b0860a91940e4f78968b3882af91ef5bf923b8a produced only deployment V3NzjTYXtH7fb3WC2P6hpWR1twhb; immediate disarm 1d1f5675ad461e9692358fd055dcf89973c1c25b produced zero additional deployments",
    "Default non-Canceled deployment counts are API 16 and Web 9; both projects remain disarmed",
    "Public read-only Web/API, exact Web security-header, historical invitation terminal-state UI, and redesigned workspace gates are complete",
    "/health proves TLS and process startup only; it does not execute SQL or prove the database DSN",
    "The real /admin password reauthentication and four-section read-only verification are complete",
    "Phase 77 runtime snapshot and Phase 79 controlled Cron tooling are not yet connected to Hosted",
    "Before migration 0014, run pnpm acceptance:hosted:backup:plan and require pnpm acceptance:hosted:backup:preflight to pass",
    "The executor readiness audit pins the PostgreSQL 17.6.1.159 image index, but remains fail-closed because the complete Supabase Auth/Storage platform image lock and reviewed write executor are absent; no backup evidence has been produced",
    "Run pnpm acceptance:hosted:backup:executor:plan and the exact pre/rebuild/post readiness checks only; they perform no database, network, or artifact write",
    "Preflight requires a secure pre-batch logical backup plus migrations-and-fictional-seed rebuild evidence for the clean current candidate",
    "apply exactly migration 0014 after explicit approval, then deploy API and Web through separate one-shot arm/disarm windows",
    "read back Hosted Email OTP length 6 -> user-triggered same-invitation resend -> latest six-digit OTP only",
    "scanner-safe repeated GET -> explicit OTP POST -> Auth SMTP delivery -> Web landing -> password relogin",
    "real R3-C delivery and duplicate/alert observation -> install and verify five Supabase Cron jobs",
    "audited kill-switch disable -> one approved Cloud DeepSeek application-path request -> model/usage/price/reservation/UsageLedger reconciliation -> restore kill switch",
    "Current Vercel Functions settings show Fluid enabled and sin1",
    "Current deployment resource /index is Node.js 24.x in SIN1 with max duration <=120s",
    "The 90-second application abort versus platform termination observation remains paired with the approved Cloud DeepSeek smoke",
    "HUAYI_DATABASE_TLS_CA_BASE64",
    "HUAYI_STORE_EXTENSION_CAPABILITY",
    "Confirmed deployment decisions (values are not printed):",
    "hosted DeepSeek key is available and small real acceptance charges are approved",
    `https://api.acceptance.seen-said.cn/v1/auth/callback\\?flow=${opaqueFlowGlob}`,
    `https://api.acceptance.seen-said.cn/v1/auth/password/confirm\\?flow=${opaqueFlowGlob}`,
    `https://api.acceptance.seen-said.cn/v1/auth/password/recovery/confirm\\?flow=${opaqueFlowGlob}`,
    `https://api.acceptance.seen-said.cn/v1/auth/reauthenticate/google/callback\\?flow=${opaqueFlowGlob}`,
    `https://api.acceptance.seen-said.cn/v1/account/sign-in-methods/google:callback\\?flow=${opaqueFlowGlob}`,
    "smtp.resend.com:465 | resend",
    "five Supabase Cron jobs",
    "backup, target-network, natural-use, Store, and Windows final-batch gates remain pending",
    "finish the complete Supabase platform image digest lock and reviewed writer -> separately approve the fixed capture/rebuild executor",
  ]) {
    assert.match(plan, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(plan, /application-password|re_hosted-test|deepseek-hosted-test/u);
  assert.doesNotMatch(plan, /HUAYI_STORE_EXTENSION_ID/u);
  assert.doesNotMatch(plan, /HUAYI_GOOGLE_AUTHENTICATION|VITE_GOOGLE_AUTHENTICATION/u);
  assert.doesNotMatch(plan, /Web Git deployment denies every branch except/u);
  assert.doesNotMatch(plan, /Web remains disabled and has no Production deployment/u);
  assert.doesNotMatch(plan, /migration 0012 -> Vercel domains/u);
  assert.doesNotMatch(plan, /zero-account public smoke -> BootstrapInvitation/u);
  assert.doesNotMatch(
    plan,
    /password registration -> SMTP confirmation -> callback -> complete Operator/u,
  );
  assert.doesNotMatch(plan, /No Auth user, invitation, SMTP, DeepSeek/u);
  assert.doesNotMatch(
    plan,
    /Current API latest is Ready deployment 9jbyfnAvZwpa3Ci7YU6s6asmNZNG at source 39094d0/u,
  );
  assert.doesNotMatch(plan, /Default non-Canceled deployment counts are API 15 and Web 8/u);
  assert.doesNotMatch(plan, /Default non-Canceled deployment counts are API 16 and Web 8/u);
  assert.doesNotMatch(plan, /the user personally enters the current password in \/admin/u);
  assert.doesNotMatch(plan, /password reauthentication -> reread all four admin sections/u);
  assert.doesNotMatch(
    plan,
    /explicitly authorize one recipient -> create exactly one ordinary invitation/u,
  );
  assert.doesNotMatch(plan, /authorize one unused recipient email/u);
  assert.doesNotMatch(plan, /Account search must return zero exact matches/u);
  assert.doesNotMatch(plan, /https:\/\/api\.acceptance\.seen-said\.cn\/\*\*/u);
  assert.doesNotMatch(plan, /flow=\*/u);
  assert.ok(
    plan.indexOf("acceptance:hosted:backup:preflight") <
      plan.indexOf("apply exactly migration 0014"),
  );
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
    { HUAYI_GOOGLE_AUTHENTICATION: "enabled" },
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
