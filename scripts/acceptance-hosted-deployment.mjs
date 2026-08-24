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
    "- Current API latest is Ready deployment 6QeRbqxgA88cFXggKekkr2axH9JM at source 4f1ce4a458fe138aeee6fb455b2dcc398a55555a.",
    "- Current Web latest is Ready deployment V3NzjTYXtH7fb3WC2P6hpWR1twhb at source 9b0860a91940e4f78968b3882af91ef5bf923b8a.",
    "- Cloud workspace redesign candidate 524a55b35dadfd1e8bd1ef89b0abc2baadf69066 was deployed only through the reviewed arm and followed by disarm d6d901c.",
    "- Phase 78 API-only arm 4f1ce4a458fe138aeee6fb455b2dcc398a55555a produced only deployment 6QeRbqxgA88cFXggKekkr2axH9JM; immediate disarm 020e21efa13bafb795d70a369e4512e76c7f7ab6 produced zero additional deployments.",
    "- Phase 80 Web-only arm 9b0860a91940e4f78968b3882af91ef5bf923b8a produced only deployment V3NzjTYXtH7fb3WC2P6hpWR1twhb; immediate disarm 1d1f5675ad461e9692358fd055dcf89973c1c25b produced zero additional deployments.",
    "- Default non-Canceled deployment counts are API 16 and Web 9; both projects remain disarmed.",
    "- Public read-only Web/API, exact Web security-header, historical invitation terminal-state UI, and redesigned workspace gates are complete.",
    "- The real /admin password reauthentication and four-section read-only verification are complete.",
    "- The only ordinary invitation has already submitted password registration; do not create or revoke another invitation or delete its bound Auth user.",
    "- Hosted Email OTP length was corrected only from 8 to 6 and independently reloaded; expiration remains 3600 and no new email has been sent.",
    "- On 2026-08-25, the real 0014 dry-run child transcript passed the strict parser: the non-mutating header, remote connection marker, exactly 20260824010000_password_signup_otp_resend.sql, and finished marker were present; the database was not modified. The wrapper fixed success line was not part of the supplied evidence and is not claimed.",
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
    "- Phase 77 runtime snapshot and Phase 79 controlled Cron tooling are not yet connected to Hosted.",
    "- Remote migration head remains 13; migration 0014 apply and the token-only resend route deployment remain pending backup preflight and explicit approval.",
    "- Before migration 0014 apply, run pnpm acceptance:hosted:backup:plan and require pnpm acceptance:hosted:backup:preflight to pass.",
    "- The complete platform lock classifies 11 active and 3 disabled CLI services and pins every active index plus linux/amd64 and linux/arm64 manifest; all 11 current macOS local image inspections passed through the fixed OrbStack socket, and the reviewed writer is pinned.",
    "- Run pnpm acceptance:hosted:backup:executor:plan and the exact pre/rebuild/post readiness checks first; readiness performs no database, network, or artifact write.",
    "- After separate approval, run only acceptance:hosted:backup:capture:pre and acceptance:hosted:backup:rebuild; each is exact-confirmation-gated and produces only the fixed ignored evidence.",
    "- Preflight requires a secure pre-batch logical backup plus migrations-and-fictional-seed rebuild evidence for the clean current candidate.",
    "- After preflight and explicit approval, run only pnpm acceptance:hosted:migration:0014:apply; it reruns the exact dry-run, rechecks preflight and migration identity before mutation, and verifies the canonical chain/0014 contract after mutation.",
    "- Read back Hosted Email OTP length 6 -> user-triggered same-invitation resend -> latest six-digit OTP only.",
    "- The same ordinary invitation must complete scanner-safe repeated GET, explicit OTP POST, Auth SMTP delivery, Web landing, and password relogin.",
    "- Real R3-C delivery must cover successful delivery, duplicate observation, and the body-free alert receiver.",
    "- Five Supabase Cron jobs remain uninstalled until the R3-C delivery gate passes.",
    "- One approved Cloud DeepSeek application-path request must reconcile model, usage, price UUID, reservation, and UsageLedger before the kill switch is restored.",
    "- The backup, target-network, natural-use, Store, and Windows final-batch gates remain pending.",
    "Current dependency chain:",
    "- current macOS local-only inspection of all 11 locked images passed -> reviewed writer pinned -> exact readiness -> separately approved pre capture/rebuild",
    "- secure pre-batch logical backup + isolated migrations-and-fictional-seed rebuild -> acceptance:hosted:backup:preflight",
    "- validated real dry-run retained as read-only evidence -> preflight -> pnpm acceptance:hosted:migration:0014:apply -> separately approved post capture -> acceptance:hosted:backup:complete -> API and Web separate one-shot arm/disarm windows",
    "- read back Hosted Email OTP length 6 -> user-triggered same-invitation resend -> latest six-digit OTP only",
    "- scanner-safe repeated GET -> explicit OTP POST -> Auth SMTP delivery -> Web landing -> password relogin",
    "- real R3-C delivery and duplicate/alert observation -> install and verify five Supabase Cron jobs",
    "- audited kill-switch disable -> one approved Cloud DeepSeek application-path request -> model/usage/price/reservation/UsageLedger reconciliation -> restore kill switch",
    "Prohibited shortcuts:",
    "- Do not recreate the First Operator, issue another BootstrapInvitation or ordinary invitation, rerun applied hosted migrations, directly create or delete a Supabase user, or switch the kill switch with SQL.",
    "- Do not apply migration 0014 before the backup preflight passes or manufacture a manifest without the separately approved real capture/rebuild stage.",
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
