import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hostedAuthConfigApplyConfirmation,
  hostedAuthConfigStatusArgument,
  runHostedAuthConfigCli,
  verifyHostedAuthConfiguration,
} from "./acceptance-hosted-auth-config.mjs";

const projectRef = "kpadiulxkgckskcfydry";
const authConfigUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const token = "supabase-hosted-test-token-at-least-32-chars";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("hosted auth verifier rejects the observed eight-digit OTP drift", () => {
  assert.equal(verifyHostedAuthConfiguration({ mailer_otp_length: 6 }), true);
  assert.throws(() => verifyHostedAuthConfiguration({ mailer_otp_length: 8 }));
  assert.throws(() => verifyHostedAuthConfiguration({}));
});

test("hosted auth status reads the exact project and fails closed on OTP drift", async () => {
  const requests = [];
  let stdout = "";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["status", hostedAuthConfigStatusArgument],
    environment: { SUPABASE_ACCESS_TOKEN: token },
    fetch_: async (url, options) => {
      requests.push({ options, url });
      return response({ mailer_otp_length: 8 });
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "Hosted Auth email OTP length verification failed.\n");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, authConfigUrl);
  assert.deepEqual(requests[0].options, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    method: "GET",
  });
});

test("hosted auth apply patches only the OTP length and verifies the persisted value", async () => {
  const requests = [];
  const replies = [
    response({ mailer_otp_length: 8, site_url: "https://app.acceptance.seen-said.cn" }),
    response({ mailer_otp_length: 6, site_url: "https://app.acceptance.seen-said.cn" }),
    response({ mailer_otp_length: 6, site_url: "https://app.acceptance.seen-said.cn" }),
  ];
  let stdout = "";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["apply", hostedAuthConfigApplyConfirmation],
    environment: { SUPABASE_ACCESS_TOKEN: token },
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
  assert.equal(stdout, "Hosted Auth email OTP length updated to 6 and verified.\n");
  assert.equal(requests.length, 3);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [authConfigUrl, authConfigUrl, authConfigUrl],
  );
  assert.deepEqual(requests[1].options, {
    body: JSON.stringify({ mailer_otp_length: 6 }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
});

test("hosted auth apply is idempotent when the OTP length is already six", async () => {
  const requests = [];
  let stdout = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["apply", hostedAuthConfigApplyConfirmation],
    environment: { SUPABASE_ACCESS_TOKEN: token },
    fetch_: async (url, options) => {
      requests.push({ options, url });
      return response({ mailer_otp_length: 6 });
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(stdout, "Hosted Auth email OTP length is already 6; no update was required.\n");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "GET");
});

test("hosted auth apply rejects an unobserved OTP length without patching", async () => {
  const requests = [];
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["apply", hostedAuthConfigApplyConfirmation],
    environment: { SUPABASE_ACCESS_TOKEN: token },
    fetch_: async (url, options) => {
      requests.push({ options, url });
      return response({ mailer_otp_length: 7 });
    },
    writeError: (value) => {
      stderr += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stderr, "Hosted Auth email OTP length update failed.\n");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "GET");
});

test("hosted auth apply fails closed when another Auth setting drifts", async () => {
  const requests = [];
  const replies = [
    response({ mailer_otp_length: 8, site_url: "https://app.acceptance.seen-said.cn" }),
    response({ mailer_otp_length: 6, site_url: "https://app.acceptance.seen-said.cn" }),
    response({ mailer_otp_length: 6, site_url: "https://changed.invalid" }),
  ];
  let stdout = "";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["apply", hostedAuthConfigApplyConfirmation],
    environment: { SUPABASE_ACCESS_TOKEN: token },
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
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "Hosted Auth email OTP length update failed.\n");
  assert.deepEqual(
    requests.map(({ options }) => options.method),
    ["GET", "PATCH", "GET"],
  );
});

test("hosted auth CLI rejects wrong confirmations and never reflects tokens", async () => {
  const secret = "supabase-secret-token-do-not-reflect-123456789";
  let stderr = "";
  const code = await runHostedAuthConfigCli({
    arguments_: ["apply", "wrong-confirmation"],
    environment: { SUPABASE_ACCESS_TOKEN: secret },
    fetch_: async () => {
      throw new Error("must not call fetch");
    },
    writeError: (value) => {
      stderr += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stderr, "Hosted Auth configuration arguments are invalid.\n");
  assert.doesNotMatch(stderr, new RegExp(secret, "u"));
});
