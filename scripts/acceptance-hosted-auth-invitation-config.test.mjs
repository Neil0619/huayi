import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  hostedInvitationAuthConfigStatusArgument,
  runHostedAuthConfigCli,
  verifyHostedInvitationAuthConfiguration,
} from "./acceptance-hosted-auth-config.mjs";

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

function invitationAuthConfiguration(overrides = {}) {
  return {
    mailer_otp_exp: 3_600,
    mailer_otp_length: 6,
    mailer_templates_confirmation_content: [
      "<p>你的语见验证码是：<strong>{{ .Token }}</strong></p>",
      '<p><a href="{{ .RedirectTo }}">打开语见并输入验证码</a></p>',
    ].join("\n"),
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

test("hosted invitation Auth verifier accepts only the exact scanner-safe contract", () => {
  assert.equal(verifyHostedInvitationAuthConfiguration(invitationAuthConfiguration()), true);

  const invalidConfigurations = [
    invitationAuthConfiguration({ mailer_otp_exp: 3_599 }),
    invitationAuthConfiguration({ mailer_otp_length: 8 }),
    invitationAuthConfiguration({ site_url: "https://changed.invalid" }),
    invitationAuthConfiguration({ uri_allow_list: hostedAuthRedirects.slice(0, -1).join(",") }),
    invitationAuthConfiguration({
      uri_allow_list: `${hostedAuthRedirects.join(",")},https://changed.invalid/**`,
    }),
    invitationAuthConfiguration({
      mailer_templates_confirmation_content:
        '<p>{{ .Token }}</p><a href="{{ .ConfirmationURL }}">确认</a>',
    }),
    invitationAuthConfiguration({
      mailer_templates_confirmation_content:
        '<p>{{ .Token }} {{ .Token }}</p><a href="{{ .RedirectTo }}">确认</a>',
    }),
    invitationAuthConfiguration({
      mailer_templates_confirmation_content: '<p>{{ .Token }}</p><a href="/confirm">确认</a>',
    }),
  ];
  for (const configuration of invalidConfigurations) {
    assert.throws(() => verifyHostedInvitationAuthConfiguration(configuration));
  }
});

test("hosted invitation Auth status is one read-only request with fixed output", async () => {
  const requests = [];
  let stdout = "";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["invitation-status", hostedInvitationAuthConfigStatusArgument],
    environment: {},
    readCredential: async () => token,
    fetch_: async (url, options) => {
      requests.push({ options, url });
      return response(invitationAuthConfiguration());
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
  assert.equal(stdout, "Hosted Auth invitation configuration verification passed.\n");
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

test("hosted invitation Auth status fails closed without reflecting configuration", async () => {
  const secretMarker = "configuration-body-must-not-be-reflected";
  let stdout = "";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["invitation-status", hostedInvitationAuthConfigStatusArgument],
    environment: {},
    readCredential: async () => token,
    fetch_: async () =>
      response(
        invitationAuthConfiguration({
          mailer_templates_confirmation_content: secretMarker,
        }),
      ),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "Hosted Auth invitation configuration verification failed.\n");
  assert.doesNotMatch(stderr, new RegExp(secretMarker, "u"));
});

test("hosted invitation Auth status has a fixed one-command package entry", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:auth:invitation:status"],
    "node scripts/acceptance-hosted-auth-config.mjs invitation-status " +
      `--status-hosted-invitation-auth-config-${projectRef}`,
  );
});
