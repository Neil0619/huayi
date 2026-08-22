import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCEPTANCE_LOCAL_BINDING_OPTION,
  ACCEPTANCE_LOCAL_NETWORK,
  ensureAcceptanceLoopbackNetwork,
  migrateAcceptanceDatabase,
  verifyAcceptanceRuntime,
} from "./acceptance-local-runtime.mjs";

test("acceptance runtime accepts only its loopback-bound Docker network", async () => {
  const calls = [];
  const safe = await ensureAcceptanceLoopbackNetwork({
    run: async (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      return {
        code: 0,
        stdout: JSON.stringify({ [ACCEPTANCE_LOCAL_BINDING_OPTION]: "127.0.0.1" }),
      };
    },
  });

  assert.equal(safe, true);
  assert.deepEqual(calls, [
    {
      arguments_: ["network", "inspect", ACCEPTANCE_LOCAL_NETWORK, "--format", "{{json .Options}}"],
      command: "docker",
      options: { capture: true },
    },
  ]);
});

test("acceptance runtime rejects an existing network with a broad binding", async () => {
  const calls = [];
  const safe = await ensureAcceptanceLoopbackNetwork({
    run: async (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      return {
        code: 0,
        stdout: JSON.stringify({ [ACCEPTANCE_LOCAL_BINDING_OPTION]: "0.0.0.0" }),
      };
    },
  });

  assert.equal(safe, false);
  assert.equal(calls.length, 1);
});

test("acceptance runtime creates and rechecks the fixed loopback network", async () => {
  const calls = [];
  const results = [
    { code: 1, stdout: "" },
    { code: 0, stdout: "" },
    {
      code: 0,
      stdout: JSON.stringify({ [ACCEPTANCE_LOCAL_BINDING_OPTION]: "127.0.0.1" }),
    },
  ];
  const safe = await ensureAcceptanceLoopbackNetwork({
    run: async (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      return results.shift();
    },
  });

  assert.equal(safe, true);
  assert.deepEqual(calls[1], {
    arguments_: [
      "network",
      "create",
      "--driver",
      "bridge",
      "--opt",
      `${ACCEPTANCE_LOCAL_BINDING_OPTION}=127.0.0.1`,
      "--label",
      "com.seen-said.acceptance=local",
      ACCEPTANCE_LOCAL_NETWORK,
    ],
    command: "docker",
    options: undefined,
  });
  assert.equal(calls.length, 3);
});

test("acceptance runtime verifies every project container on the loopback network", async () => {
  const results = [
    {
      code: 0,
      stdout: JSON.stringify({ [ACCEPTANCE_LOCAL_BINDING_OPTION]: "127.0.0.1" }),
    },
    { code: 0, stdout: "container-a\ncontainer-b\n" },
    {
      code: 0,
      stdout: [
        JSON.stringify({
          Networks: { [ACCEPTANCE_LOCAL_NETWORK]: {} },
          Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }] },
        }),
        JSON.stringify({
          Networks: { [ACCEPTANCE_LOCAL_NETWORK]: {} },
          Ports: { "9999/tcp": null },
        }),
      ].join("\n"),
    },
  ];

  assert.equal(await verifyAcceptanceRuntime({ run: async () => results.shift() }), true);
});

test("acceptance runtime rejects a project container published to the LAN", async () => {
  const results = [
    {
      code: 0,
      stdout: JSON.stringify({ [ACCEPTANCE_LOCAL_BINDING_OPTION]: "127.0.0.1" }),
    },
    { code: 0, stdout: "container-a\n" },
    {
      code: 0,
      stdout: JSON.stringify({
        Networks: { [ACCEPTANCE_LOCAL_NETWORK]: {} },
        Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "54322" }] },
      }),
    },
  ];

  assert.equal(await verifyAcceptanceRuntime({ run: async () => results.shift() }), false);
});

test("acceptance migration uses the pinned CLI only between two safe runtime checks", async () => {
  const calls = [];
  const checks = [];
  const result = await migrateAcceptanceDatabase({
    run: async (command, arguments_) => {
      calls.push({ arguments_, command });
      return { code: 0, stdout: "private output must stay hidden" };
    },
    verify: async () => {
      checks.push("verify");
      return true;
    },
  });

  assert.equal(result, true);
  assert.deepEqual(checks, ["verify", "verify"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].arguments_[0], /node_modules\/supabase\/dist\/supabase\.js$/u);
  assert.deepEqual(calls[0].arguments_.slice(1), [
    "migration",
    "up",
    "--local",
    "--output",
    "json",
  ]);
});

test("acceptance migration never invokes the CLI for an unsafe runtime", async () => {
  let called = false;
  const result = await migrateAcceptanceDatabase({
    run: async () => {
      called = true;
      return { code: 0, stdout: "" };
    },
    verify: async () => false,
  });

  assert.equal(result, false);
  assert.equal(called, false);
});
