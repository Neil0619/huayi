import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createHostedAcceptanceHmacKeyring } from "./acceptance-hosted-deepseek-one-shot-hmac.mjs";
import {
  hostedDeepSeekAcceptanceKeyringAccount,
  hostedDeepSeekAcceptanceKeyringContract,
  loadHostedDeepSeekAcceptanceKeyring,
  runHostedKeychainPromptCommand,
} from "./acceptance-hosted-deepseek-one-shot-production-keyring.mjs";
import { hostedCredentialService } from "./acceptance-hosted-credentials.mjs";

const operationId = "40000000-0000-4000-8000-000000000004";

function encodedKey(byte) {
  return Buffer.alloc(32, byte).toString("base64url");
}

function keyringDocument(activeVersion = 2) {
  return JSON.stringify({
    activeVersion,
    contract: hostedDeepSeekAcceptanceKeyringContract,
    keys: [
      { material: encodedKey(1), version: 1 },
      { material: encodedKey(2), version: 2 },
    ],
  });
}

test("production keyring loads an independent active key and retained historical versions", async () => {
  const calls = [];
  const keyring = await loadHostedDeepSeekAcceptanceKeyring({
    createIfMissing: false,
    environment: {},
    platform: "darwin",
    runSecurity: async (request) => {
      calls.push(request);
      return { code: 0, stderr: "", stdout: `${keyringDocument()}\n` };
    },
  });

  assert.equal(keyring.create(operationId).version, 2);
  const historical = createHostedAcceptanceHmacKeyring({
    activeVersion: 1,
    keys: new Map([[1, Buffer.alloc(32, 1)]]),
  }).create(operationId);
  assert.deepEqual(keyring.recover({ ...historical, operationId }), historical);
  assert.deepEqual(calls, [
    {
      arguments_: [
        "find-generic-password",
        "-s",
        hostedCredentialService,
        "-a",
        hostedDeepSeekAcceptanceKeyringAccount,
        "-w",
      ],
      interactive: false,
    },
  ]);
});

test("execute may create one random versioned key without putting it in arguments or environment", async () => {
  const promptCalls = [];
  let storedDocument;
  let reads = 0;
  const keyring = await loadHostedDeepSeekAcceptanceKeyring({
    createIfMissing: true,
    environment: {
      HOME: "/Users/fictional",
      VERCEL_TOKEN: "must-not-propagate",
    },
    platform: "darwin",
    randomBytes_: (size) => {
      assert.equal(size, 32);
      return Buffer.alloc(32, 7);
    },
    runSecurity: async () => {
      reads += 1;
      return storedDocument === undefined
        ? { code: 44, stderr: "private", stdout: "" }
        : { code: 0, stderr: "", stdout: `${storedDocument}\n` };
    },
    runSecurityPrompt: async (request) => {
      promptCalls.push(request);
      storedDocument = request.value;
      return { code: 0 };
    },
  });

  assert.equal(reads, 2);
  assert.equal(keyring.create(operationId).version, 1);
  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0].arguments_.at(-1), "-w");
  assert.equal(promptCalls[0].arguments_.includes("-U"), false);
  assert.equal(JSON.stringify(promptCalls[0].arguments_).includes(encodedKey(7)), false);
  assert.equal(JSON.stringify(promptCalls[0].environment).includes("must-not-propagate"), false);
  const document = JSON.parse(promptCalls[0].value);
  assert.deepEqual(document, {
    activeVersion: 1,
    contract: hostedDeepSeekAcceptanceKeyringContract,
    keys: [{ material: encodedKey(7), version: 1 }],
  });
});

test("status and recovery never invent a missing keyring", async () => {
  let writes = 0;
  await assert.rejects(
    loadHostedDeepSeekAcceptanceKeyring({
      createIfMissing: false,
      environment: {},
      platform: "darwin",
      runSecurity: async () => ({ code: 44, stderr: "private", stdout: "" }),
      runSecurityPrompt: async () => {
        writes += 1;
        return { code: 0 };
      },
    }),
    /^Error: Hosted Cloud Web DeepSeek production keyring failed closed\.$/u,
  );
  assert.equal(writes, 0);
});

test("keyring rejects unsupported platforms and malformed or inaccessible Keychain data", async () => {
  await assert.rejects(
    loadHostedDeepSeekAcceptanceKeyring({
      createIfMissing: true,
      platform: "win32",
      runSecurity: async () => assert.fail("security must not run"),
    }),
    /^Error: Hosted Cloud Web DeepSeek production keyring failed closed\.$/u,
  );
  for (const result of [
    { code: 0, stderr: "", stdout: "{}\n" },
    { code: 36, stderr: "private", stdout: "" },
    { code: 128, stderr: "private", stdout: "" },
  ]) {
    await assert.rejects(
      loadHostedDeepSeekAcceptanceKeyring({
        createIfMissing: true,
        environment: {},
        platform: "darwin",
        runSecurity: async () => result,
        runSecurityPrompt: async () => assert.fail("writer must not run"),
      }),
      /^Error: Hosted Cloud Web DeepSeek production keyring failed closed\.$/u,
    );
  }
});

test("prompt runner sends the secret only through a discarded pseudo-terminal input pipe", async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.kill = () => true;
  const received = [];
  child.stdin.on("data", (chunk) => received.push(chunk));
  let invocation;
  const secret = keyringDocument();
  const resultPromise = runHostedKeychainPromptCommand({
    arguments_: ["add-generic-password", "-s", hostedCredentialService, "-w"],
    environment: {
      HOME: "/Users/fictional",
      PATH: "/private/bin",
      VERCEL_TOKEN: "must-not-propagate",
    },
    spawnProcess: (command, arguments_, options) => {
      invocation = { arguments_, command, options };
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
    timeoutMilliseconds: 100,
    value: secret,
  });
  const result = await resultPromise;

  assert.deepEqual(result, { code: 0 });
  assert.equal(invocation.command, "/usr/bin/script");
  assert.deepEqual(invocation.arguments_.slice(0, 4), [
    "-q",
    "-e",
    "/dev/null",
    "/usr/bin/security",
  ]);
  assert.deepEqual(invocation.options.stdio, ["pipe", "ignore", "ignore"]);
  assert.equal(invocation.options.shell, false);
  assert.equal(JSON.stringify(invocation).includes(secret), false);
  assert.equal(JSON.stringify(invocation.options.env).includes("must-not-propagate"), false);
  assert.equal(Buffer.concat(received).toString("utf8"), `${secret}\n`);
});
