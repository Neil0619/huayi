import assert from "node:assert/strict";
import test from "node:test";

import {
  createHostedCronBootstrapReleaseState,
  createHostedReleaseState,
  validateHostedReleaseState,
} from "./acceptance-hosted-release-contract.mjs";
import { createHostedCronBootstrapReleaseGate } from "./acceptance-hosted-cron-bootstrap-release.mjs";
import { runHostedReleaseOrchestrator } from "./acceptance-hosted-release-orchestrator.mjs";

const candidateSha = "c".repeat(40);
const freshReleaseAttemptId = `hosted-attempt-${"a".repeat(32)}`;

function candidate(overrides = {}) {
  return {
    branch: "codex/settings-configuration",
    candidateSha,
    clean: true,
    pushed: true,
    upstreamSha: candidateSha,
    vercelDisarmed: true,
    ...overrides,
  };
}

function legacyCompleteState() {
  return {
    apiDeploymentId: "dpl_api_legacy_123",
    branch: "codex/settings-configuration",
    candidateSha,
    ciRunId: 42,
    createdAt: 100,
    phase: "complete",
    releaseId: `hosted-acceptance-${candidateSha}`,
    schemaVersion: 1,
    updatedAt: 200,
    webDeploymentId: "dpl_web_legacy_123",
  };
}

function legacyAttemptCompleteState() {
  return {
    ...legacyCompleteState(),
    releaseAttemptId: freshReleaseAttemptId,
    schemaVersion: 2,
  };
}

function memoryStore(initial) {
  const calls = [];
  let state = initial;
  let locked = false;
  return {
    calls,
    async acquire() {
      assert.equal(locked, false);
      calls.push("acquire");
      locked = true;
      return async () => {
        calls.push("release");
        locked = false;
      };
    },
    async read() {
      calls.push("read");
      return state;
    },
    async write(next) {
      assert.equal(locked, true);
      calls.push("write");
      state = next;
    },
    state: () => state,
  };
}

test("provision reserves an unused exact-SHA release and records it only after the upsert", async () => {
  const store = memoryStore(undefined);
  const calls = [];
  const gate = await createHostedCronBootstrapReleaseGate({
    createReleaseAttemptId: () => freshReleaseAttemptId,
    createStateStore: () => store,
    inspectCandidate: async () => candidate(),
    now: () => 123,
  });

  const result = await gate.provision(async () => {
    calls.push("upsert");
    assert.equal(store.state(), undefined);
    return "done";
  });

  assert.equal(result, "done");
  assert.deepEqual(store.calls, ["acquire", "read", "write", "release"]);
  assert.deepEqual(calls, ["upsert"]);
  assert.equal(store.state().candidateSha, candidateSha);
  assert.equal(store.state().phase, "candidate-recorded");
  assert.equal(store.state().provenance, "cron-bootstrap-provision");
  assert.equal(store.state().releaseAttemptId, freshReleaseAttemptId);
  assert.equal(store.state().createdAt, 123);
});

test("provision rejects an old completed release before the environment upsert", async () => {
  const store = memoryStore({ phase: "complete" });
  let operationCalls = 0;
  const gate = await createHostedCronBootstrapReleaseGate({
    createStateStore: () => store,
    inspectCandidate: async () => candidate(),
  });

  await assert.rejects(
    gate.provision(async () => {
      operationCalls += 1;
    }),
    /release gate failed closed/u,
  );

  assert.equal(operationCalls, 0);
  assert.deepEqual(store.calls, ["acquire", "read", "release"]);
});

test("failed provision does not reserve bootstrap provenance", async () => {
  const store = memoryStore(undefined);
  const gate = await createHostedCronBootstrapReleaseGate({
    createReleaseAttemptId: () => freshReleaseAttemptId,
    createStateStore: () => store,
    inspectCandidate: async () => candidate(),
  });

  await assert.rejects(
    gate.provision(async () => {
      throw new Error("upsert failed");
    }),
    /upsert failed/u,
  );

  assert.deepEqual(store.calls, ["acquire", "read", "release"]);
  assert.equal(store.state(), undefined);
});

test("the release gate requires a clean pushed disarmed candidate on the fixed branch", async () => {
  for (const override of [
    { branch: "main" },
    { clean: false },
    { pushed: false, upstreamSha: "0".repeat(40) },
    { upstreamSha: "0".repeat(40) },
    { vercelDisarmed: false },
  ]) {
    let stateStoreCalls = 0;
    await assert.rejects(
      createHostedCronBootstrapReleaseGate({
        createStateStore: () => {
          stateStoreCalls += 1;
          return memoryStore(undefined);
        },
        inspectCandidate: async () => candidate(override),
      }),
      /release gate failed closed/u,
    );
    assert.equal(stateStoreCalls, 0);
  }
});

test("provision rechecks candidate identity under the release lock before remote I/O", async () => {
  const store = memoryStore(undefined);
  let inspections = 0;
  let operationCalls = 0;
  const gate = await createHostedCronBootstrapReleaseGate({
    createStateStore: () => store,
    inspectCandidate: async () => {
      inspections += 1;
      return inspections === 1 ? candidate() : candidate({ clean: false });
    },
  });

  await assert.rejects(
    gate.provision(async () => {
      operationCalls += 1;
    }),
    /release gate failed closed/u,
  );

  assert.equal(operationCalls, 0);
  assert.deepEqual(store.calls, ["acquire", "read", "release"]);
});

test("a provisioned candidate continues through a newly created API deployment and attestation", async () => {
  const store = memoryStore(undefined);
  const calls = [];
  let now = 100;
  const gate = await createHostedCronBootstrapReleaseGate({
    createStateStore: () => store,
    inspectCandidate: async () => candidate(),
    now: () => {
      now += 1;
      return now;
    },
  });
  await gate.provision(async () => {
    calls.push("upsert");
  });

  const completed = await runHostedReleaseOrchestrator({
    candidateSha,
    ci: {
      async dispatch() {
        throw new Error("must use the existing exact-SHA run");
      },
      async find() {
        calls.push("ci-find");
        return { id: 42 };
      },
      async wait() {
        calls.push("ci-wait");
      },
    },
    git: {
      inspect: async () => candidate(),
      async localQuality() {
        calls.push("local-quality");
      },
      async push() {
        throw new Error("candidate is already pushed");
      },
    },
    mode: "advance",
    now: () => {
      now += 1;
      return now;
    },
    sleep: async () => undefined,
    stateStore: store,
    vercel: {
      async attest() {
        calls.push("runtime-attest");
      },
      async configure() {
        calls.push("api-configure");
      },
      async create({ kind }) {
        calls.push(`${kind}-create`);
        return { id: `dpl_${kind}_bootstrap_123` };
      },
      async find() {
        return undefined;
      },
      async inspect() {
        return { configurationReady: true };
      },
      async wait({ kind }) {
        calls.push(`${kind}-wait`);
      },
    },
  });

  assert.equal(completed.phase, "complete");
  assert.ok(calls.indexOf("upsert") < calls.indexOf("api-create"));
  assert.ok(calls.indexOf("api-create") < calls.indexOf("runtime-attest"));
});

test("absent clone-local state cannot reuse a pre-provision API deployment", async () => {
  const store = memoryStore(undefined);
  const calls = [];
  let attestation;
  const gate = await createHostedCronBootstrapReleaseGate({
    createReleaseAttemptId: () => freshReleaseAttemptId,
    createStateStore: () => store,
    inspectCandidate: async () => candidate(),
    now: () => 100,
  });
  await gate.provision(async () => {
    calls.push("upsert");
  });

  const completed = await runHostedReleaseOrchestrator({
    candidateSha,
    ci: {
      async dispatch() {
        throw new Error("must use the existing exact-SHA run");
      },
      async find() {
        return { id: 42 };
      },
      async wait() {
        calls.push("ci-wait");
      },
    },
    git: {
      inspect: async () => candidate(),
      async localQuality() {
        calls.push("local-quality");
      },
      async push() {
        throw new Error("candidate is already pushed");
      },
    },
    mode: "advance",
    now: () => 101,
    sleep: async () => undefined,
    stateStore: store,
    vercel: {
      async attest(evidence) {
        attestation = evidence;
      },
      async configure() {
        calls.push("api-configure");
      },
      async create({ kind, releaseAttemptId }) {
        calls.push(`${kind}-create`);
        assert.equal(releaseAttemptId, freshReleaseAttemptId);
        return { id: `dpl_${kind}_fresh_123` };
      },
      async find({ kind, releaseAttemptId }) {
        calls.push(`${kind}-find`);
        if (kind === "api" && releaseAttemptId === undefined) {
          return { id: "dpl_api_old_123" };
        }
        assert.equal(releaseAttemptId, freshReleaseAttemptId);
        return undefined;
      },
      async inspect() {
        return { configurationReady: true };
      },
      async wait({ kind, releaseAttemptId }) {
        calls.push(`${kind}-wait`);
        assert.equal(releaseAttemptId, freshReleaseAttemptId);
      },
    },
  });

  assert.equal(completed.apiDeploymentId, "dpl_api_fresh_123");
  assert.equal(calls.filter((call) => call === "api-create").length, 1);
  assert.equal(calls.filter((call) => call === "api-find").length, 0);
  assert.deepEqual(attestation, {
    apiDeploymentId: "dpl_api_fresh_123",
    candidateSha,
    releaseAttemptId: freshReleaseAttemptId,
    webDeploymentId: "dpl_web_fresh_123",
  });
});

test("delivery accepts only a completed same-SHA release and freshly attests its deployment ids", async () => {
  const state = validateHostedReleaseState({
    ...createHostedCronBootstrapReleaseState({
      candidateSha,
      now: 100,
      releaseAttemptId: freshReleaseAttemptId,
    }),
    apiDeploymentId: "dpl_api_bootstrap_123",
    ciRunId: 42,
    phase: "complete",
    updatedAt: 200,
    webDeploymentId: "dpl_web_bootstrap_123",
  });
  const store = memoryStore(state);
  const attestations = [];
  const gate = await createHostedCronBootstrapReleaseGate({
    createRuntime: () => ({
      async attest(evidence) {
        attestations.push(evidence);
      },
    }),
    createStateStore: () => store,
    inspectCandidate: async () => candidate(),
  });

  await gate.attestCompleted();

  assert.deepEqual(attestations, [
    {
      apiDeploymentId: "dpl_api_bootstrap_123",
      candidateSha,
      releaseAttemptId: freshReleaseAttemptId,
      webDeploymentId: "dpl_web_bootstrap_123",
    },
  ]);
});

test("bootstrap delivery rejects legacy complete states without provision provenance", async () => {
  for (const state of [legacyCompleteState(), legacyAttemptCompleteState()]) {
    let attestCalls = 0;
    const gate = await createHostedCronBootstrapReleaseGate({
      createRuntime: () => ({
        async attest() {
          attestCalls += 1;
        },
      }),
      createStateStore: () => memoryStore(state),
      inspectCandidate: async () => candidate(),
    });

    await assert.rejects(gate.attestCompleted(), /release gate failed closed/u);
    assert.equal(attestCalls, 0);
  }
});

test("bootstrap delivery rejects an ordinary release created from absent state", async () => {
  const ordinaryComplete = validateHostedReleaseState({
    ...createHostedReleaseState({
      candidateSha,
      now: 100,
      releaseAttemptId: freshReleaseAttemptId,
    }),
    apiDeploymentId: "dpl_api_ordinary_123",
    ciRunId: 42,
    phase: "complete",
    updatedAt: 200,
    webDeploymentId: "dpl_web_ordinary_123",
  });
  let attestCalls = 0;
  const gate = await createHostedCronBootstrapReleaseGate({
    createRuntime: () => ({
      async attest() {
        attestCalls += 1;
      },
    }),
    createStateStore: () => memoryStore(ordinaryComplete),
    inspectCandidate: async () => candidate(),
  });

  await assert.rejects(gate.attestCompleted(), /release gate failed closed/u);
  assert.equal(attestCalls, 0);
});

test("delivery rejects incomplete release state and candidate drift before runtime I/O", async () => {
  for (const [currentCandidate, state] of [
    [candidate(), undefined],
    [
      candidate(),
      createHostedReleaseState({
        candidateSha,
        now: 100,
        releaseAttemptId: freshReleaseAttemptId,
      }),
    ],
    [
      candidate({ candidateSha: "d".repeat(40), upstreamSha: "d".repeat(40) }),
      {
        ...createHostedReleaseState({
          candidateSha,
          now: 100,
          releaseAttemptId: freshReleaseAttemptId,
        }),
        apiDeploymentId: "dpl_api_bootstrap_123",
        ciRunId: 42,
        phase: "complete",
        updatedAt: 200,
        webDeploymentId: "dpl_web_bootstrap_123",
      },
    ],
  ]) {
    let attestCalls = 0;
    const gate = await createHostedCronBootstrapReleaseGate({
      createRuntime: () => ({
        async attest() {
          attestCalls += 1;
        },
      }),
      createStateStore: () => memoryStore(state),
      inspectCandidate: async () => currentCandidate,
    });

    await assert.rejects(gate.attestCompleted(), /release gate failed closed/u);
    assert.equal(attestCalls, 0);
  }
});
