import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  HostedCredentialError,
  hostedCredentialIds,
  hostedCredentialService,
  inspectHostedCredential,
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
  runHostedCredentialsCli,
  runSecurityCommand,
} from "./acceptance-hosted-credentials.mjs";

const secrets = Object.freeze({
  "supabase-admin-db-password": "fictional-administrator-password",
  "supabase-application-db-password": "fictional-application-password-0001",
  "supabase-management-token": "fictional-supabase-management-token",
  "vercel-token": "fictional-vercel-personal-access-token",
});

test("hosted credentials freeze the Keychain service and four infrastructure accounts", () => {
  assert.equal(hostedCredentialService, "cn.seen-said.huayi.hosted.acceptance");
  assert.deepEqual(hostedCredentialIds, Object.keys(secrets));
  assert.equal(Object.isFrozen(hostedCredentialIds), true);
});

test("hosted credential reads use an absolute security command and never expose the value", async () => {
  const calls = [];
  const secret = secrets["vercel-token"];
  const value = await readHostedCredential("vercel-token", {
    environment: {},
    platform: "darwin",
    runSecurity: async (request) => {
      calls.push(request);
      return { code: 0, stderr: "", stdout: `${secret}\n` };
    },
  });

  assert.equal(value, secret);
  assert.deepEqual(calls, [
    {
      arguments_: [
        "find-generic-password",
        "-s",
        hostedCredentialService,
        "-a",
        "vercel-token",
        "-w",
      ],
      interactive: false,
    },
  ]);
  assert.equal(JSON.stringify(calls).includes(secret), false);
});

test("hosted credential configuration delegates hidden input directly to security", async () => {
  const calls = [];
  const events = [];
  const output = [];
  const code = await runHostedCredentialsCli({
    arguments_: ["configure", "--name", "supabase-management-token"],
    environment: {},
    platform: "darwin",
    runSecurity: async (request) => {
      calls.push(request);
      if (request.arguments_[0] === "find-generic-password" && !request.arguments_.includes("-w")) {
        return { code: 44, stderr: "", stdout: "" };
      }
      if (request.interactive) {
        events.push("security-input");
        return { code: 0, stderr: "", stdout: "" };
      }
      return {
        code: 0,
        stderr: "",
        stdout: `${secrets["supabase-management-token"]}\n`,
      };
    },
    stdinIsTTY: true,
    stderrIsTTY: true,
    writeOutput: (value) => {
      output.push(value);
      events.push(value.trim());
    },
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], {
    arguments_: [
      "add-generic-password",
      "-U",
      "-s",
      hostedCredentialService,
      "-a",
      "supabase-management-token",
      "-l",
      "语见 Hosted Supabase management token",
      "-w",
    ],
    interactive: true,
  });
  assert.equal(
    calls[1].arguments_.some((value) => Object.values(secrets).includes(value)),
    false,
  );
  assert.equal(
    output.join(""),
    "credential|supabase-management-token|input-required\n" +
      "credential|supabase-management-token|configured\n",
  );
  assert.deepEqual(events, [
    "credential|supabase-management-token|input-required",
    "security-input",
    "credential|supabase-management-token|configured",
  ]);
});

test("hosted credential package syntax accepts pnpm's separator after the fixed operation", async () => {
  const output = [];
  const code = await runHostedCredentialsCli({
    arguments_: ["status", "--", "--name", "vercel-token"],
    environment: {},
    platform: "darwin",
    runSecurity: async () => ({ code: 44, stderr: "private", stdout: "private" }),
    writeOutput: (value) => output.push(value),
  });

  assert.equal(code, 1);
  assert.equal(output.join(""), "credential|vercel-token|missing\n");
});

test("hosted credential configure validates existing items before reporting them present", async () => {
  const output = [];
  const errors = [];
  const code = await runHostedCredentialsCli({
    arguments_: ["configure", "--name", "vercel-token"],
    environment: {},
    platform: "darwin",
    runSecurity: async ({ arguments_ }) =>
      arguments_.includes("-w")
        ? { code: 0, stderr: "", stdout: "short\n" }
        : { code: 0, stderr: "", stdout: "private metadata" },
    stdinIsTTY: true,
    stderrIsTTY: true,
    writeError: (value) => errors.push(value),
    writeOutput: (value) => output.push(value),
  });

  assert.equal(code, 1);
  assert.equal(output.join(""), "");
  assert.equal(errors.join(""), "Hosted credential command failed.\n");
});

test("multi-account configure preflights every item before mutating Keychain", async () => {
  const calls = [];
  const code = await runHostedCredentialsCli({
    arguments_: ["configure"],
    environment: {},
    platform: "darwin",
    runSecurity: async ({ arguments_, interactive }) => {
      calls.push({ arguments_, interactive });
      assert.equal(interactive, false);
      const account = arguments_[arguments_.indexOf("-a") + 1];
      if (account === "supabase-management-token") {
        return { code: 36, stderr: "private", stdout: "" };
      }
      return { code: 44, stderr: "", stdout: "" };
    },
    stdinIsTTY: true,
    stderrIsTTY: true,
  });

  assert.equal(code, 1);
  assert.equal(
    calls.some(({ arguments_ }) => arguments_[0] === "add-generic-password"),
    false,
  );
});

test("multi-account configure reports completed mutations before a later cancellation", async () => {
  const output = [];
  let writes = 0;
  const code = await runHostedCredentialsCli({
    arguments_: ["configure"],
    environment: {},
    platform: "darwin",
    runSecurity: async ({ arguments_, interactive }) => {
      const account = arguments_[arguments_.indexOf("-a") + 1];
      if (arguments_[0] === "find-generic-password" && !arguments_.includes("-w")) {
        return { code: 44, stderr: "", stdout: "" };
      }
      if (interactive) {
        writes += 1;
        return writes === 1
          ? { code: 0, stderr: "", stdout: "" }
          : { code: 128, stderr: "private", stdout: "" };
      }
      return { code: 0, stderr: "", stdout: `${secrets[account]}\n` };
    },
    stdinIsTTY: true,
    stderrIsTTY: true,
    writeOutput: (value) => output.push(value),
  });

  assert.equal(code, 1);
  assert.equal(
    output.join(""),
    "credential|supabase-admin-db-password|input-required\n" +
      "credential|supabase-admin-db-password|configured\n" +
      "credential|supabase-application-db-password|input-required\n",
  );
});

test("multi-account remove preflights every item before deleting Keychain data", async () => {
  const calls = [];
  const code = await runHostedCredentialsCli({
    arguments_: ["remove"],
    environment: {},
    platform: "darwin",
    runSecurity: async ({ arguments_ }) => {
      calls.push(arguments_);
      const account = arguments_[arguments_.indexOf("-a") + 1];
      if (account === "supabase-management-token") {
        return { code: 36, stderr: "private", stdout: "" };
      }
      return { code: 0, stderr: "private metadata", stdout: "" };
    },
  });

  assert.equal(code, 1);
  assert.equal(
    calls.some((arguments_) => arguments_[0] === "delete-generic-password"),
    false,
  );
});

test("hosted credential status does not request password data", async () => {
  const calls = [];
  const state = await inspectHostedCredential("supabase-admin-db-password", {
    platform: "darwin",
    runSecurity: async (request) => {
      calls.push(request);
      return { code: 0, stderr: "private metadata", stdout: "private metadata" };
    },
  });

  assert.equal(state, "present");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments_.includes("-w"), false);

  const output = [];
  assert.equal(
    await runHostedCredentialsCli({
      arguments_: ["status", "--name", "supabase-admin-db-password"],
      environment: {},
      platform: "darwin",
      runSecurity: async () => ({ code: 44, stderr: "private", stdout: "private" }),
      writeOutput: (value) => output.push(value),
    }),
    1,
  );
  assert.equal(output.join(""), "credential|supabase-admin-db-password|missing\n");
});

test("hosted credentials classify missing, locked, denied, invalid, and unsupported safely", async () => {
  const scenarios = [
    { code: 44, expected: "missing", stderr: "private" },
    { code: 36, expected: "locked", stderr: "private" },
    { code: 128, expected: "denied", stderr: "private" },
  ];
  for (const scenario of scenarios) {
    const output = [];
    const code = await runHostedCredentialsCli({
      arguments_: ["diagnose", "--name", "vercel-token"],
      environment: {},
      platform: "darwin",
      runSecurity: async () => ({ ...scenario, stdout: "private" }),
      writeOutput: (value) => output.push(value),
    });
    assert.equal(code, 1);
    assert.equal(output.join(""), `credential|vercel-token|${scenario.expected}\n`);
    assert.doesNotMatch(output.join(""), /private/u);
  }

  const invalidOutput = [];
  assert.equal(
    await runHostedCredentialsCli({
      arguments_: ["diagnose", "--name", "vercel-token"],
      environment: {},
      platform: "darwin",
      runSecurity: async () => ({ code: 0, stderr: "", stdout: "short\n" }),
      writeOutput: (value) => invalidOutput.push(value),
    }),
    1,
  );
  assert.equal(invalidOutput.join(""), "credential|vercel-token|invalid\n");

  const unsupportedErrors = [];
  assert.equal(
    await runHostedCredentialsCli({
      arguments_: ["status"],
      environment: {},
      platform: "win32",
      runSecurity: async () => assert.fail("security must not run"),
      writeError: (value) => unsupportedErrors.push(value),
    }),
    1,
  );
  assert.equal(
    unsupportedErrors.join(""),
    "Hosted credential command is unsupported on this platform.\n",
  );

  const unavailableOutput = [];
  const unavailableErrors = [];
  assert.equal(
    await runHostedCredentialsCli({
      arguments_: ["diagnose", "--name", "vercel-token"],
      environment: {},
      platform: "darwin",
      runSecurity: async () => ({ code: 1, stderr: "private", stdout: "private" }),
      writeError: (value) => unavailableErrors.push(value),
      writeOutput: (value) => unavailableOutput.push(value),
    }),
    1,
  );
  assert.equal(unavailableOutput.join(""), "");
  assert.equal(unavailableErrors.join(""), "Hosted credential command failed.\n");
});

test("hosted credentials reject every legacy plaintext environment input", async () => {
  for (const name of [
    "PGPASSWORD",
    "SUPABASE_DB_PASSWORD",
    "HUAYI_HOSTED_APP_DATABASE_PASSWORD",
    "SUPABASE_ACCESS_TOKEN",
    "VERCEL_TOKEN",
    "HUAYI_HOSTED_MANAGEMENT_TOKEN",
    "HUAYI_HOSTED_SOURCE_DATABASE_PASSWORD",
    "HUAYI_HOSTED_TARGET_DATABASE_PASSWORD",
  ]) {
    assert.throws(
      () => rejectLegacyHostedCredentialEnvironment({ [name]: "private" }),
      /Hosted plaintext credential environment is forbidden\./u,
    );
    await assert.rejects(
      readHostedCredential("supabase-admin-db-password", {
        environment: { [name]: "private" },
        platform: "darwin",
        runSecurity: async () => assert.fail("security must not run"),
      }),
      /Hosted plaintext credential environment is forbidden\./u,
    );
  }
});

test("hosted credential values remove only security's final LF and reject CRLF", async () => {
  await assert.rejects(
    readHostedCredential("vercel-token", {
      environment: {},
      platform: "darwin",
      runSecurity: async () => ({
        code: 0,
        stderr: "",
        stdout: `${secrets["vercel-token"]}\r\n`,
      }),
    }),
    (error) => error instanceof HostedCredentialError && error.state === "invalid",
  );
});

test("hosted credential errors never retain private subprocess text", () => {
  const error = new HostedCredentialError("denied");
  for (const rendered of [String(error), error.stack, JSON.stringify(error)]) {
    assert.doesNotMatch(rendered, /private|secret|token-value/u);
  }
});

test("security runner fixes executable, environment, timeout, and close semantics", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let invocation;
  let resolved = false;
  const promise = runSecurityCommand({
    arguments_: ["find-generic-password", "-s", hostedCredentialService],
    environment: {
      HOME: "/Users/fictional",
      LANG: "private-locale",
      LC_ALL: "private-locale",
      PATH: "/private/bin",
      VERCEL_TOKEN: "private-token-value",
    },
    spawnProcess: (command, arguments_, options) => {
      invocation = { arguments_, command, options };
      return child;
    },
    timeoutMilliseconds: 100,
  }).then((result) => {
    resolved = true;
    return result;
  });
  child.stdout.end("value\n");
  child.emit("exit", 0, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  child.emit("close", 0, null);
  const result = await promise;

  assert.equal(invocation.command, "/usr/bin/security");
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.env, {
    HOME: "/Users/fictional",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/private/bin",
  });
  assert.deepEqual(result, { code: 0, stderr: "", stdout: "value\n" });
  assert.equal(JSON.stringify(invocation).includes("private-token-value"), false);
});

test("security runner kills timed-out commands and discards captured output", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
    queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  };
  const result = await runSecurityCommand({
    arguments_: ["find-generic-password", "-s", hostedCredentialService],
    environment: {},
    spawnProcess: () => {
      child.stdout.write("private-token-value");
      return child;
    },
    timeoutMilliseconds: 1,
  });
  assert.equal(killed, true);
  assert.deepEqual(result, { code: null, stderr: "", stdout: "" });
});

test("security runner enforces one combined output bound across both channels", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
    queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  };
  const resultPromise = runSecurityCommand({
    arguments_: ["find-generic-password", "-s", hostedCredentialService],
    environment: {},
    spawnProcess: () => child,
    timeoutMilliseconds: 100,
  });
  child.stdout.write("a".repeat(5_000));
  child.stderr.write("b".repeat(4_000));
  setImmediate(() => {
    if (!killed) child.emit("close", 0, null);
  });
  const result = await resultPromise;

  assert.equal(killed, true);
  assert.deepEqual(result, { code: null, stderr: "", stdout: "" });
});

test("hosted credential mutation requires a real terminal and never falls back to stdin", async () => {
  const errors = [];
  const code = await runHostedCredentialsCli({
    arguments_: ["rotate", "--name", "vercel-token"],
    environment: {},
    platform: "darwin",
    runSecurity: async () => assert.fail("security must not run"),
    stdinIsTTY: false,
    stderrIsTTY: false,
    writeError: (value) => errors.push(value),
  });
  assert.equal(code, 1);
  assert.equal(errors.join(""), "Hosted credential command failed.\n");
});
