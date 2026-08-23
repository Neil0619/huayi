import { pathToFileURL } from "node:url";

import { readApiEnvironment } from "../apps/api/src/environment.ts";
import {
  hostedAcceptanceApplicationRole,
  hostedAcceptanceExportBucket,
  hostedAcceptancePriceVersionIds,
  hostedAcceptanceProjectRef,
} from "./acceptance-hosted-foundation.mjs";

const apiOrigin = "https://api.acceptance.seen-said.cn";
const webOrigin = "https://app.acceptance.seen-said.cn";
const supabaseUrl = `https://${hostedAcceptanceProjectRef}.supabase.co`;
const authRedirects = Object.freeze([
  `${apiOrigin}/v1/auth/callback`,
  `${apiOrigin}/v1/auth/password/callback`,
  `${apiOrigin}/v1/auth/password/recovery/confirm`,
  `${apiOrigin}/v1/auth/reauthenticate/google/callback`,
  `${apiOrigin}/v1/account/sign-in-methods/google:callback`,
]);

const publicApiEnvironmentNames = Object.freeze([
  "HUAYI_API_ORIGIN",
  "HUAYI_WEB_ORIGIN",
  "SUPABASE_URL",
  "HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID",
  "HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID",
  "HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID",
  "HUAYI_STORE_EXTENSION_CAPABILITY",
  "HUAYI_MIN_SUPPORTED_EXTENSION_VERSION",
  "HUAYI_ACCOUNT_EXPORT_BUCKET",
  "HUAYI_SECURITY_NOTIFICATION_MODE",
  "HUAYI_SECURITY_NOTIFICATION_FROM",
  "HUAYI_SECURITY_NOTIFICATION_REPLY_TO",
]);

const sensitiveApiEnvironmentNames = Object.freeze([
  "HUAYI_DATABASE_URL",
  "HUAYI_DATABASE_TLS_CA_BASE64",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HUAYI_REFRESH_ENCRYPTION_KEY",
  "HUAYI_SECRET_PEPPER",
  "CRON_SECRET",
  "HUAYI_DEEPSEEK_API_KEY",
  "HUAYI_RESEND_API_KEY",
]);

export function renderHostedDeploymentPlan() {
  return [
    "Hosted acceptance deployment plan (zero network / zero write)",
    "Projects:",
    "- seen-said-acceptance-api | apps/api | hono | sin1 | Fluid | 120s",
    "- seen-said-acceptance-web | apps/web | vite | pnpm build | dist",
    "- Both projects: include source outside Root Directory; Production only; Preview disabled.",
    "Git deployment safety:",
    "- API Git deployment allows only codex/settings-configuration; Web disables every branch.",
    "- The API allowlist is an armed window; every matching-branch push can deploy API.",
    "- Next: deploy one reviewed post-rotation commit to API by exact SHA.",
    "API public environment names:",
    ...publicApiEnvironmentNames.map((name) => `- ${name}`),
    "API sensitive environment names:",
    ...sensitiveApiEnvironmentNames.map((name) => `- ${name}`),
    "Web build environment names:",
    "- VITE_API_ORIGIN",
    "- VITE_DEPLOYMENT_ENVIRONMENT",
    "- VERCEL_GIT_COMMIT_SHA (injected, not copied)",
    "Supabase Auth exact redirects:",
    ...authRedirects.map((redirect) => `- ${redirect}`),
    "Supabase Auth SMTP:",
    "- smtp.resend.com:465 | resend | separate sending-only key",
    "Runtime verification boundary:",
    "- /health proves TLS and process startup only; it does not execute SQL or prove the database DSN.",
    "- Once the new deployment record exists, the only allowed next push is the API disarm commit,",
    "  regardless of Ready, Error, or smoke outcome.",
    "- Verify the disarm commit created no API or Web deployment; only then run health and DB-backed runtime smoke.",
    "- Web remains disabled and has no Production deployment.",
    "DNS and deployment sequence:",
    "- migration 0012 -> Vercel domains -> Resend DNS -> Auth/SMTP -> Production environment",
    "- post-rotation exact-SHA API deployment -> disarm API -> verify no new deployment -> runtime smoke",
    "- Web remains disabled with no Production deployment; Web deployment and its smoke gates are deferred",
    "- five Supabase Cron jobs -> FirstOperatorBootstrap invitation",
    "Confirmed deployment decisions (values are not printed):",
    "- Reply-To/support mailbox is available",
    "- hosted DeepSeek key is available and small real acceptance charges are approved",
    "- Store Extension capability is disabled for the first hosted acceptance round",
    "",
  ].join("\n");
}

function assertEqual(actual, expected) {
  if (actual !== expected) throw new Error("Hosted acceptance deployment contract mismatch.");
}

export function verifyHostedDeploymentEnvironment(environment) {
  const parsed = readApiEnvironment(environment);
  assertEqual(parsed.HUAYI_API_ORIGIN, apiOrigin);
  assertEqual(parsed.HUAYI_WEB_ORIGIN, webOrigin);
  assertEqual(parsed.SUPABASE_URL, supabaseUrl);
  assertEqual(parsed.HUAYI_ACCOUNT_EXPORT_BUCKET, hostedAcceptanceExportBucket);
  assertEqual(
    parsed.HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID,
    hostedAcceptancePriceVersionIds.legacy,
  );
  assertEqual(
    parsed.HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID,
    hostedAcceptancePriceVersionIds.offPeak,
  );
  assertEqual(parsed.HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID, hostedAcceptancePriceVersionIds.peak);
  assertEqual(parsed.HUAYI_MIN_SUPPORTED_EXTENSION_VERSION, "1.0.0");
  assertEqual(parsed.HUAYI_STORE_EXTENSION_CAPABILITY, "disabled");
  assertEqual(parsed.HUAYI_SECURITY_NOTIFICATION_MODE, "resend");
  assertEqual(
    parsed.HUAYI_SECURITY_NOTIFICATION_FROM,
    "语见 <security@notify.acceptance.seen-said.cn>",
  );
  const database = new URL(parsed.HUAYI_DATABASE_URL);
  assertEqual(
    database.username,
    `${hostedAcceptanceApplicationRole}.${hostedAcceptanceProjectRef}`,
  );
  return true;
}

export async function runHostedDeploymentCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length !== 1 || !new Set(["--plan", "--verify-environment"]).has(arguments_[0])) {
    writeError("Hosted acceptance deployment arguments are invalid.\n");
    return 1;
  }
  if (arguments_[0] === "--plan") {
    writeOutput(renderHostedDeploymentPlan());
    return 0;
  }
  try {
    verifyHostedDeploymentEnvironment(environment);
    writeOutput("Hosted acceptance deployment environment verification passed.\n");
    return 0;
  } catch {
    writeError("Hosted acceptance deployment environment verification failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeploymentCli();
}
