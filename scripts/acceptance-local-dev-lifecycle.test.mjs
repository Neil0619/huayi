import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePid,
  probeLoopbackEndpoints,
  spawnDetachedServer,
  startPersistentServer,
  stopPersistentServer,
  waitUntilHealthy,
} from "./acceptance-local-dev-lifecycle.mjs";

test("persistent acceptance health requires every HTTPS endpoint on IPv4 and IPv6", async () => {
  const calls = [];

  assert.equal(
    await probeLoopbackEndpoints("local-ca", async (url, ca, family) => {
      calls.push({ ca, family, url });
      return true;
    }),
    true,
  );
  assert.deepEqual(
    calls.map(({ family, url }) => ({ family, url })),
    [
      { family: 4, url: "https://app.acceptance.localhost:8443/app" },
      { family: 6, url: "https://app.acceptance.localhost:8443/app" },
      { family: 4, url: "https://api.acceptance.localhost:8444/health" },
      { family: 6, url: "https://api.acceptance.localhost:8444/health" },
      { family: 4, url: "https://supabase.acceptance.localhost:8445/auth/v1/health" },
      { family: 6, url: "https://supabase.acceptance.localhost:8445/auth/v1/health" },
    ],
  );
  assert.ok(calls.every(({ ca }) => ca === "local-ca"));
});

test("persistent acceptance health fails when either address family is unavailable", async () => {
  assert.equal(
    await probeLoopbackEndpoints("local-ca", async (url, _ca, family) => {
      return !(url.includes(":8443/") && family === 6);
    }),
    false,
  );
});

test("persistent acceptance health rejects another process answering while the child exits", async () => {
  let running = true;
  let probes = 0;

  assert.equal(
    await waitUntilHealthy(4321, "local-ca", {
      delay: async () => {
        running = false;
      },
      isRunning: () => running,
      probe: async () => {
        probes += 1;
        return true;
      },
    }),
    false,
  );
  assert.equal(probes, 1);
});

test("persistent acceptance server accepts only one positive pid", () => {
  assert.equal(parsePid("4321\n"), 4321);
  assert.equal(parsePid("0"), null);
  assert.equal(parsePid("4321 extra"), null);
});

test("persistent acceptance server detaches from the launching terminal", () => {
  const calls = [];
  const child = { pid: 4321, unref: () => undefined };
  const result = spawnDetachedServer({
    environment: { SAFE: "value" },
    spawnProcess(command, arguments_, options) {
      calls.push({ arguments_, command, options });
      return child;
    },
  });

  assert.equal(result, child);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
  assert.equal(calls[0].options.shell, false);
});

test("persistent acceptance start records and unreferences only a healthy child", async () => {
  const events = [];
  const child = {
    pid: 4321,
    unref() {
      events.push("unref");
    },
  };

  assert.equal(
    await startPersistentServer({
      existingPid: async () => null,
      isRunning: () => true,
      probe: async () => true,
      removePid: async () => events.push("remove"),
      spawnServer: () => child,
      stopProcess: () => events.push("stop"),
      writePid: async (pid) => events.push(`write:${pid}`),
    }),
    true,
  );
  assert.deepEqual(events, ["write:4321", "unref"]);
});

test("persistent acceptance start removes state and stops an unhealthy child", async () => {
  const events = [];
  const child = { pid: 4321, unref: () => undefined };

  assert.equal(
    await startPersistentServer({
      existingPid: async () => null,
      isRunning: () => true,
      probe: async () => false,
      removePid: async () => events.push("remove"),
      spawnServer: () => child,
      stopProcess: () => events.push("stop"),
      writePid: async (pid) => events.push(`write:${pid}`),
    }),
    false,
  );
  assert.deepEqual(events, ["write:4321", "stop", "remove"]);
});

test("persistent acceptance start replaces an unhealthy recorded process", async () => {
  const events = [];
  const runningPids = new Set([4321, 5678]);
  const child = {
    pid: 5678,
    unref() {
      events.push("unref");
    },
  };

  assert.equal(
    await startPersistentServer({
      existingPid: async () => 4321,
      isRunning: (pid) => runningPids.has(pid),
      probe: async (pid) => pid === 5678,
      removePid: async () => events.push("remove"),
      spawnServer: () => child,
      stopProcess: (pid) => {
        events.push(`stop:${pid}`);
        runningPids.delete(pid);
      },
      writePid: async (pid) => events.push(`write:${pid}`),
    }),
    true,
  );
  assert.deepEqual(events, ["stop:4321", "remove", "write:5678", "unref"]);
});

test("persistent acceptance stop waits for forced termination before reporting failure", async () => {
  const events = [];
  let running = true;
  let forcedChecks = 0;

  assert.equal(
    await stopPersistentServer({
      delay: async () => undefined,
      existingPid: async () => 4321,
      isRunning: () => {
        if (forcedChecks === 0) return running;
        forcedChecks += 1;
        if (forcedChecks >= 3) running = false;
        return running;
      },
      removePid: async () => events.push("remove"),
      stopProcess: (_pid, signal = "SIGTERM") => {
        events.push(signal);
        if (signal === "SIGKILL") forcedChecks = 1;
      },
    }),
    true,
  );
  assert.deepEqual(events, ["SIGTERM", "SIGKILL", "remove"]);
});
