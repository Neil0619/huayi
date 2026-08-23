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
const opaqueFlowGlob = "?".repeat(43);
const authRedirects = Object.freeze([
  `${apiOrigin}/v1/auth/callback\\?flow=${opaqueFlowGlob}`,
  `${apiOrigin}/v1/auth/password/confirm\\?flow=${opaqueFlowGlob}`,
  `${apiOrigin}/v1/auth/password/recovery/confirm\\?flow=${opaqueFlowGlob}`,
  `${apiOrigin}/v1/auth/reauthenticate/google/callback\\?flow=${opaqueFlowGlob}`,
  `${apiOrigin}/v1/account/sign-in-methods/google:callback\\?flow=${opaqueFlowGlob}`,
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
    "Hosted acceptance current action ledger (zero network / zero write)",
    "Projects:",
    "- seen-said-acceptance-api | apps/api | hono | sin1 | Fluid | 120s",
    "- seen-said-acceptance-web | apps/web | vite | pnpm build:vercel | dist",
    "- Both projects: include source outside Root Directory; Production only; Preview disabled.",
    "Completed gates (do not repeat):",
    "- First Operator is completed and the post-completion verifier passed; do not rerun foundation bootstrap, migration 0012/0013, or BootstrapInvitation.",
    "- Current API latest is Ready deployment 9jbyfnAvZwpa3Ci7YU6s6asmNZNG at source 39094d0c557b829138ec6f70b6fc838f4594ab9b.",
    "- Current Web latest is Ready deployment DU6wE2r9ZLeSSoAMZAbsQihBjC72 at source f3feff1252673e715a5624c9539f04d8078a5d4b.",
    "- Cloud workspace redesign candidate 524a55b35dadfd1e8bd1ef89b0abc2baadf69066 was deployed only through the reviewed arm and followed by disarm d6d901c.",
    "- Default non-Canceled deployment counts are API 15 and Web 8; both projects remain disarmed.",
    "- Public read-only Web/API, exact Web security-header, historical invitation terminal-state UI, and redesigned workspace gates are complete.",
    "Git deployment safety:",
    "- API and Web Git deployment both disable every branch.",
    "- Do not re-arm or redeploy either project for the remaining user, mail, Cron, or Provider gates.",
    "- Any future deployment requires a separately reviewed arm -> one deployment -> immediate disarm sequence.",
    "API public environment names:",
    ...publicApiEnvironmentNames.map((name) => `- ${name}`),
    "API sensitive environment names:",
    ...sensitiveApiEnvironmentNames.map((name) => `- ${name}`),
    "Web build environment names:",
    "- VITE_API_ORIGIN",
    "- VITE_DEPLOYMENT_ENVIRONMENT",
    "- VERCEL_GIT_COMMIT_SHA (injected, not copied)",
    "Supabase Auth query-aware exact-path redirects:",
    ...authRedirects.map((redirect) => `- ${redirect}`),
    "Supabase Auth SMTP:",
    "- smtp.resend.com:465 | resend | separate sending-only key",
    "Runtime verification boundary:",
    "- /health proves TLS and process startup only; it does not execute SQL or prove the database DSN.",
    "- Current /health, application-role database, CORS, unauthenticated boundary, hosted identity, security-header, and secret-scan probes passed.",
    "Deployed Function evidence:",
    "- Current Vercel Functions settings show Fluid enabled and sin1.",
    "- Current deployment resource /index is Node.js 24.x in SIN1 with max duration <=120s.",
    "- The 90-second application abort versus platform termination observation remains paired with the approved Cloud DeepSeek smoke.",
    "Pending user and external gates:",
    "- User-only gate: the user personally enters the current password in /admin; automation must not read, store, or submit it.",
    "- The user then verifies all four admin sections and permissions before creating one ordinary invitation.",
    "- The ordinary invitation must complete scanner-safe repeated GET, explicit OTP POST, Auth SMTP delivery, Web landing, and password relogin.",
    "- Real R3-C delivery must cover successful delivery, duplicate observation, and the body-free alert receiver.",
    "- Five Supabase Cron jobs remain uninstalled until the R3-C delivery gate passes.",
    "- One approved Cloud DeepSeek application-path request must reconcile model, usage, price UUID, reservation, and UsageLedger before the kill switch is restored.",
    "Current dependency chain:",
    "- password reauthentication -> reread all four admin sections and permissions -> create one ordinary invitation",
    "- scanner-safe repeated GET -> explicit OTP POST -> Auth SMTP delivery -> Web landing -> password relogin",
    "- real R3-C delivery and duplicate/alert observation -> install and verify five Supabase Cron jobs",
    "- audited kill-switch disable -> one approved Cloud DeepSeek application-path request -> model/usage/price/reservation/UsageLedger reconciliation -> restore kill switch",
    "Prohibited shortcuts:",
    "- Do not recreate the First Operator, issue another BootstrapInvitation, rerun hosted bootstrap/migrations, directly create a Supabase user, or switch the kill switch with SQL.",
    "- Do not run Classic smoke:deepseek, send test mail outside the product path, or install Cron before its delivery prerequisite.",
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
  assertEqual(parsed.HUAYI_GOOGLE_AUTHENTICATION, undefined);
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
