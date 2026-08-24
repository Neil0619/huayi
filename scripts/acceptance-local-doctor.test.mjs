import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACCEPTANCE_LOCAL_CHECK_IDS,
  inspectAcceptanceLocal,
  runAcceptanceLocalDoctor,
} from "./acceptance-local-doctor.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("local acceptance doctor owns a fixed prerequisite contract", () => {
  assert.deepEqual(ACCEPTANCE_LOCAL_CHECK_IDS, [
    "node-runtime",
    "docker-cli",
    "docker-daemon",
    "loopback-network",
    "supabase-cli",
    "local-ca",
    "leaf-certificate",
    "supabase-config",
    "environment-template",
    "migration-baseline",
    "migration-forward",
    "seed-data",
  ]);
});

test("local acceptance doctor reports only fixed safe blocker codes", async () => {
  const privateDiagnostic = "secret-token=https://private.example.invalid";
  const result = await inspectAcceptanceLocal({
    check: async (id) =>
      id === "node-runtime" ? { ok: true } : { diagnostic: privateDiagnostic, ok: false },
    root: repositoryRoot,
  });

  assert.equal(result.ready, false);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.code),
    ACCEPTANCE_LOCAL_CHECK_IDS.slice(1),
  );
  assert.equal(JSON.stringify(result).includes(privateDiagnostic), false);
});

test("local acceptance doctor succeeds only when every prerequisite passes", async () => {
  const result = await inspectAcceptanceLocal({
    check: async () => ({ ok: true }),
    root: repositoryRoot,
  });

  assert.deepEqual(result, { blockers: [], ready: true });
});

test("local acceptance doctor CLI emits bounded status without command output", async () => {
  const stdout = [];
  const stderr = [];
  const exitCode = await runAcceptanceLocalDoctor({
    inspect: async () => ({
      blockers: [
        { code: "docker-daemon", message: "Docker daemon is not ready." },
        { code: "local-ca", message: "The local trust tool is not ready." },
      ],
      ready: false,
    }),
    stderr: { write: (value) => stderr.push(value) },
    stdout: { write: (value) => stdout.push(value) },
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.join(""), "");
  assert.equal(
    stderr.join(""),
    "Local acceptance prerequisites are blocked.\n" +
      "- docker-daemon: Docker daemon is not ready.\n" +
      "- local-ca: The local trust tool is not ready.\n",
  );
});

test("local acceptance artifacts stay secret-free and local values stay ignored", async () => {
  const [
    ignore,
    environment,
    config,
    packageDocument,
    apiBaseline,
    supabaseBaseline,
    apiForward,
    supabaseForward,
    apiPairingForward,
    supabasePairingForward,
    apiLatestForward,
    supabaseLatestForward,
    apiQuotaForward,
    supabaseQuotaForward,
    apiNotificationForward,
    supabaseNotificationForward,
    apiOperatorForward,
    supabaseOperatorForward,
    apiSignupRecoveryForward,
    supabaseSignupRecoveryForward,
    apiSignupResendForward,
    supabaseSignupResendForward,
    seed,
    runtime,
    reset,
  ] = await Promise.all([
    readFile(resolve(repositoryRoot, ".gitignore"), "utf8"),
    readFile(resolve(repositoryRoot, ".env.acceptance.example"), "utf8"),
    readFile(resolve(repositoryRoot, "supabase/config.toml"), "utf8"),
    readFile(resolve(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(repositoryRoot, "apps/api/migrations/0001-cloud-v1-foundation.sql"), "utf8"),
    readFile(
      resolve(repositoryRoot, "supabase/migrations/20260821000000_cloud_v1_foundation.sql"),
      "utf8",
    ),
    readFile(resolve(repositoryRoot, "apps/api/migrations/0002-account-default-quota.sql"), "utf8"),
    readFile(
      resolve(repositoryRoot, "supabase/migrations/20260821010000_account_default_quota.sql"),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "apps/api/migrations/0008-extension-pairing-atomic-snapshot.sql"),
      "utf8",
    ),
    readFile(
      resolve(
        repositoryRoot,
        "supabase/migrations/20260821070000_extension_pairing_atomic_snapshot.sql",
      ),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "apps/api/migrations/0009-account-deletion-replay.sql"),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "supabase/migrations/20260821080000_account_deletion_replay.sql"),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "apps/api/migrations/0010-quota-lifecycle-and-model-rate-limit.sql"),
      "utf8",
    ),
    readFile(
      resolve(
        repositoryRoot,
        "supabase/migrations/20260822010000_quota_lifecycle_and_model_rate_limit.sql",
      ),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "apps/api/migrations/0011-security-notification-delivery.sql"),
      "utf8",
    ),
    readFile(
      resolve(
        repositoryRoot,
        "supabase/migrations/20260822020000_security_notification_delivery.sql",
      ),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "apps/api/migrations/0012-first-operator-bootstrap.sql"),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "supabase/migrations/20260822030000_first_operator_bootstrap.sql"),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "apps/api/migrations/0013-password-signup-interruption-recovery.sql"),
      "utf8",
    ),
    readFile(
      resolve(
        repositoryRoot,
        "supabase/migrations/20260823010000_password_signup_interruption_recovery.sql",
      ),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "apps/api/migrations/0014-password-signup-otp-resend.sql"),
      "utf8",
    ),
    readFile(
      resolve(repositoryRoot, "supabase/migrations/20260824010000_password_signup_otp_resend.sql"),
      "utf8",
    ),
    readFile(resolve(repositoryRoot, "supabase/seed.sql"), "utf8"),
    readFile(resolve(repositoryRoot, "scripts/acceptance-local-runtime.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "scripts/acceptance-local-reset.mjs"), "utf8"),
  ]);

  assert.match(ignore, /^\.env\.acceptance\.local$/mu);
  assert.match(ignore, /^!\.env\.acceptance\.example$/mu);
  assert.equal(environment.includes("REPLACE_WITH"), true);
  assert.equal(environment.includes("resend_"), false);
  assert.doesNotMatch(environment, /^HUAYI_DEEPSEEK_API_KEY=/mu);
  assert.match(config, /^project_id = "seen-and-said-local-acceptance"$/mu);
  assert.doesNotMatch(config, /^schema_paths =/mu);
  assert.match(config, /^enable_confirmations = true$/mu);
  assert.equal(config.includes("enable_confirmations = false"), false);
  assert.match(config, /^minimum_password_length = 12$/mu);
  assert.match(config, /^password_requirements = ""$/mu);
  assert.equal(supabaseBaseline, apiBaseline);
  assert.equal(supabaseForward, apiForward);
  assert.equal(supabasePairingForward, apiPairingForward);
  assert.equal(supabaseLatestForward, apiLatestForward);
  assert.equal(supabaseQuotaForward, apiQuotaForward);
  assert.equal(supabaseNotificationForward, apiNotificationForward);
  assert.equal(supabaseOperatorForward, apiOperatorForward);
  assert.equal(supabaseSignupRecoveryForward, apiSignupRecoveryForward);
  assert.equal(supabaseSignupResendForward, apiSignupResendForward);
  assert.match(runtime, /com\.docker\.network\.bridge\.host_binding_ipv4/u);
  assert.match(runtime, /127\.0\.0\.1/u);
  assert.match(runtime, /--network-id/u);
  assert.match(seed, /local-acceptance-operator@seen-said\.localhost/u);
  assert.match(seed, /ensure_current_default_quota/u);
  assert.doesNotMatch(seed, /auth\.users|account_sign_in_methods|invitations|web_sessions/u);
  assert.match(reset, /--confirm-local-data-loss/u);
  assert.equal(
    packageDocument.scripts["acceptance:local:doctor"],
    "node scripts/acceptance-local-doctor.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:local:start"],
    "node scripts/acceptance-local-runtime.mjs start",
  );
  assert.equal(
    packageDocument.scripts["acceptance:local:migrate"],
    "node scripts/acceptance-local-runtime.mjs migrate",
  );
  assert.equal(
    packageDocument.scripts["acceptance:local:reset"],
    "node scripts/acceptance-local-reset.mjs",
  );
  assert.equal(packageDocument.devDependencies.supabase, "2.115.0");
});
