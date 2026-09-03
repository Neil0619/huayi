import assert from "node:assert/strict";
import test from "node:test";

import {
  createHostedReleaseState,
  transitionHostedReleaseState,
} from "./acceptance-hosted-release-contract.mjs";
import { runHostedReleaseOrchestrator } from "./acceptance-hosted-release-orchestrator.mjs";

const candidateSha = "1".repeat(40);
const releaseAttemptId = `hosted-attempt-${"1".repeat(32)}`;

function memoryStore(initial) {
  let state = initial;
  let locked = false;
  return {
    async acquire({ recover } = {}) {
      assert.equal(locked, false);
      assert.equal(typeof recover, "boolean");
      locked = true;
      return async () => {
        locked = false;
      };
    },
    async read() {
      return state;
    },
    async write(next) {
      assert.equal(locked, true);
      state = next;
    },
  };
}

function harness(initialState) {
  const calls = [];
  let pushed = false;
  let configured = false;
  let ciDispatched = false;
  let now = 100;
  const candidate = () => ({
    branch: "codex/settings-configuration",
    candidateSha,
    clean: true,
    pushed,
    upstreamSha: pushed ? candidateSha : "0".repeat(40),
    vercelDisarmed: true,
  });
  return {
    calls,
    createReleaseAttemptId: () => releaseAttemptId,
    ci: {
      async dispatch() {
        calls.push("ci-dispatch");
        ciDispatched = true;
      },
      async find() {
        calls.push("ci-find");
        return ciDispatched ? { conclusion: null, id: 101, status: "queued" } : undefined;
      },
      async wait() {
        calls.push("ci-wait");
        return { conclusion: "success", id: 101, status: "completed" };
      },
    },
    git: {
      async inspect() {
        calls.push("git-inspect");
        return candidate();
      },
      async localQuality() {
        calls.push("local-quality");
      },
      async push() {
        calls.push("git-push");
        pushed = true;
      },
    },
    now: () => {
      now += 1;
      return now;
    },
    stateStore: memoryStore(initialState),
    vercel: {
      async attest() {
        calls.push("postflight");
      },
      async configure() {
        calls.push("api-configure");
        configured = true;
      },
      async create({ kind }) {
        calls.push(`${kind}-create`);
        return { id: `dpl_${kind}_release_123`, state: "QUEUED" };
      },
      async find({ kind }) {
        calls.push(`${kind}-find`);
        return undefined;
      },
      async inspect() {
        calls.push("vercel-inspect");
        return {
          configurationReady: configured,
          noInFlightDeployments: true,
          projectsReady: true,
        };
      },
      async wait({ deploymentId, kind }) {
        calls.push(`${kind}-wait`);
        return { id: deploymentId, state: "READY" };
      },
    },
  };
}

test("advance runs local quality, exact CI, API, Web, and postflight in strict order", async () => {
  const setup = harness(undefined);
  const completed = await runHostedReleaseOrchestrator({
    candidateSha,
    mode: "advance",
    sleep: async () => undefined,
    ...setup,
  });

  assert.equal(completed.phase, "complete");
  assert.equal(completed.candidateSha, candidateSha);
  assert.ok(setup.calls.indexOf("local-quality") < setup.calls.indexOf("git-push"));
  assert.ok(setup.calls.indexOf("git-push") < setup.calls.indexOf("ci-dispatch"));
  assert.ok(setup.calls.indexOf("ci-wait") < setup.calls.indexOf("api-configure"));
  assert.ok(setup.calls.indexOf("api-wait") < setup.calls.indexOf("web-create"));
  assert.ok(setup.calls.indexOf("web-wait") < setup.calls.indexOf("postflight"));
  assert.equal(setup.calls.includes("deepseek"), false);
  assert.equal(setup.calls.includes("migration"), false);
});

test("recover reconciles an already dispatched CI run without dispatching a duplicate", async () => {
  let state = createHostedReleaseState({ candidateSha, now: 1, releaseAttemptId });
  for (const phase of ["local-quality-passed", "candidate-pushed", "ci-dispatching"]) {
    state = transitionHostedReleaseState(state, { now: state.updatedAt + 1, phase });
  }
  const setup = harness(state);
  setup.git.inspect = async () => ({
    branch: "codex/settings-configuration",
    candidateSha,
    clean: true,
    pushed: true,
    upstreamSha: candidateSha,
    vercelDisarmed: true,
  });
  setup.ci.find = async () => ({ conclusion: null, id: 101, status: "queued" });

  const completed = await runHostedReleaseOrchestrator({
    candidateSha,
    mode: "recover",
    sleep: async () => undefined,
    ...setup,
  });
  assert.equal(completed.phase, "complete");
  assert.equal(setup.calls.includes("ci-dispatch"), false);
});

test("advance reconciles a CI dispatch that succeeded remotely before the local error", async () => {
  const setup = harness(undefined);
  let dispatchAttempted = false;
  setup.ci.dispatch = async () => {
    setup.calls.push("ci-dispatch");
    dispatchAttempted = true;
    throw new Error("connection closed after dispatch");
  };
  setup.ci.find = async () => {
    setup.calls.push("ci-find");
    return dispatchAttempted ? { conclusion: null, id: 101, status: "queued" } : undefined;
  };

  const completed = await runHostedReleaseOrchestrator({
    candidateSha,
    mode: "advance",
    sleep: async () => undefined,
    ...setup,
  });

  assert.equal(completed.phase, "complete");
  assert.equal(setup.calls.filter((call) => call === "ci-dispatch").length, 1);
});

test("advance reconciles API configuration that became exact before the local error", async () => {
  const setup = harness(undefined);
  let configurationReady = false;
  setup.vercel.configure = async () => {
    setup.calls.push("api-configure");
    configurationReady = true;
    throw new Error("connection closed after configuration");
  };
  setup.vercel.inspect = async () => {
    setup.calls.push("vercel-inspect");
    return {
      configurationReady,
      noInFlightDeployments: true,
      projectsReady: true,
    };
  };

  const completed = await runHostedReleaseOrchestrator({
    candidateSha,
    mode: "advance",
    sleep: async () => undefined,
    ...setup,
  });

  assert.equal(completed.phase, "complete");
  assert.equal(setup.calls.filter((call) => call === "api-configure").length, 1);
});

test("advance reconciles an API deployment created before the local error", async () => {
  const setup = harness(undefined);
  let apiCreateAttempted = false;
  setup.vercel.create = async ({ kind, releaseAttemptId: actualAttemptId }) => {
    assert.equal(actualAttemptId, releaseAttemptId);
    setup.calls.push(`${kind}-create`);
    if (kind === "api") {
      apiCreateAttempted = true;
      throw new Error("connection closed after deployment create");
    }
    return { id: `dpl_${kind}_release_123`, state: "QUEUED" };
  };
  setup.vercel.find = async ({ kind, releaseAttemptId: actualAttemptId }) => {
    assert.equal(actualAttemptId, releaseAttemptId);
    setup.calls.push(`${kind}-find`);
    return kind === "api" && apiCreateAttempted
      ? { id: "dpl_api_release_123", state: "QUEUED" }
      : undefined;
  };

  const completed = await runHostedReleaseOrchestrator({
    candidateSha,
    mode: "advance",
    sleep: async () => undefined,
    ...setup,
  });

  assert.equal(completed.phase, "complete");
  assert.equal(setup.calls.filter((call) => call === "api-create").length, 1);
  assert.ok(setup.calls.indexOf("api-create") < setup.calls.indexOf("api-find"));
});

test("ordinary advance refuses to guess from a pre-existing uncertainty state", async () => {
  let state = createHostedReleaseState({ candidateSha, now: 1, releaseAttemptId });
  for (const phase of ["local-quality-passed", "candidate-pushed", "ci-dispatching"]) {
    state = transitionHostedReleaseState(state, { now: state.updatedAt + 1, phase });
  }
  const setup = harness(state);
  await assert.rejects(
    runHostedReleaseOrchestrator({
      candidateSha,
      mode: "advance",
      sleep: async () => undefined,
      ...setup,
    }),
    /^Error: Hosted acceptance release orchestration failed closed\.$/u,
  );
});
