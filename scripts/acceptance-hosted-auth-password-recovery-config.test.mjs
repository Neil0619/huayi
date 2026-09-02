import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  hostedPasswordRecoveryAuthConfigApplyConfirmation,
  hostedPasswordRecoveryAuthConfigStatusArgument,
  runHostedAuthConfigCli,
  verifyHostedPasswordRecoveryAuthConfiguration,
} from "./acceptance-hosted-auth-config.mjs";
import {
  hostedLegacyPasswordRecoveryTemplate,
  hostedPasswordRecoveryTemplate,
} from "./acceptance-hosted-auth-contract.mjs";

const projectRef = "kpadiulxkgckskcfydry";
const authConfigUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const token = "supabase-hosted-test-token-at-least-32-chars";
const opaqueFlowGlob = "?".repeat(43);
const hostedAuthRedirects = [
  `https://api.acceptance.seen-said.cn/v1/auth/callback\\?flow=${opaqueFlowGlob}`,
  `https://api.acceptance.seen-said.cn/v1/auth/password/confirm\\?flow=${opaqueFlowGlob}`,
  `https://api.acceptance.seen-said.cn/v1/auth/password/recovery/confirm\\?flow=${opaqueFlowGlob}`,
  `https://api.acceptance.seen-said.cn/v1/auth/reauthenticate/google/callback\\?flow=${opaqueFlowGlob}`,
  `https://api.acceptance.seen-said.cn/v1/account/sign-in-methods/google:callback\\?flow=${opaqueFlowGlob}`,
];

function configuration(overrides = {}) {
  return {
    mailer_otp_exp: 3_600,
    mailer_templates_recovery_content: hostedPasswordRecoveryTemplate,
    site_url: "https://app.acceptance.seen-said.cn",
    uri_allow_list: hostedAuthRedirects.join(","),
    ...overrides,
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("hosted password recovery Auth verifier accepts only the direct token-hash template", () => {
  assert.equal(verifyHostedPasswordRecoveryAuthConfiguration(configuration()), true);
  for (const invalid of [
    configuration({ mailer_templates_recovery_content: "{{ .ConfirmationURL }}" }),
    configuration({ mailer_templates_recovery_content: "{{ .RedirectTo }}" }),
    configuration({ mailer_templates_recovery_content: "{{ .TokenHash }}" }),
    configuration({
      mailer_templates_recovery_content: `${hostedPasswordRecoveryTemplate} {{ .ConfirmationURL }}`,
    }),
  ]) {
    assert.throws(() => verifyHostedPasswordRecoveryAuthConfiguration(invalid));
  }
});

test("hosted password recovery Auth status is one read-only request with fixed output", async () => {
  const requests = [];
  let stdout = "";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["password-recovery-status", hostedPasswordRecoveryAuthConfigStatusArgument],
    environment: {},
    readCredential: async () => token,
    fetch_: async (url, options) => {
      requests.push({ options, url });
      return response(configuration());
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "Hosted Auth password recovery configuration verification passed.\n");
  assert.deepEqual(requests, [
    {
      options: {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        method: "GET",
      },
      url: authConfigUrl,
    },
  ]);
});

test("hosted password recovery Auth apply patches only the recovery template", async () => {
  const requests = [];
  const replies = [
    response(
      configuration({
        mailer_templates_recovery_content: hostedLegacyPasswordRecoveryTemplate,
      }),
    ),
    response(configuration()),
    response(configuration()),
  ];
  let stdout = "";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["password-recovery-apply", hostedPasswordRecoveryAuthConfigApplyConfirmation],
    environment: {},
    readCredential: async () => token,
    fetch_: async (url, options) => {
      requests.push({ options, url });
      return replies.shift();
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "Hosted Auth password recovery configuration updated and verified.\n");
  assert.deepEqual(
    requests.map(({ options }) => options.method),
    ["GET", "PATCH", "GET"],
  );
  assert.deepEqual(requests[1].options, {
    body: JSON.stringify({
      mailer_templates_recovery_content: hostedPasswordRecoveryTemplate,
    }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
});

test("hosted password recovery Auth apply is idempotent and fails closed on drift", async () => {
  let stdout = "";
  const requests = [];
  const code = await runHostedAuthConfigCli({
    arguments_: ["password-recovery-apply", hostedPasswordRecoveryAuthConfigApplyConfirmation],
    environment: {},
    readCredential: async () => token,
    fetch_: async (url, options) => {
      requests.push({ options, url });
      return response(configuration());
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "Hosted Auth password recovery configuration is already exact; no update was required.\n",
  );
  assert.equal(requests.length, 1);

  let stderr = "";
  const driftReplies = [
    response(
      configuration({
        mailer_templates_recovery_content: hostedLegacyPasswordRecoveryTemplate,
      }),
    ),
    response(configuration()),
    response(configuration({ site_url: "https://changed.invalid" })),
  ];
  const driftCode = await runHostedAuthConfigCli({
    arguments_: ["password-recovery-apply", hostedPasswordRecoveryAuthConfigApplyConfirmation],
    environment: {},
    readCredential: async () => token,
    fetch_: async () => driftReplies.shift(),
    writeError: (value) => {
      stderr += value;
    },
  });
  assert.equal(driftCode, 1);
  assert.equal(stderr, "Hosted Auth password recovery configuration update failed.\n");
});

test("hosted password recovery Auth commands have fixed package entries", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:auth:password-recovery:status"],
    "node scripts/acceptance-hosted-auth-config.mjs password-recovery-status " +
      `--status-hosted-password-recovery-auth-config-${projectRef}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:auth:password-recovery:apply"],
    "node scripts/acceptance-hosted-auth-config.mjs password-recovery-apply " +
      `--confirm-hosted-password-recovery-auth-config-${projectRef}`,
  );
});
