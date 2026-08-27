import assert from "node:assert/strict";
import test from "node:test";

import {
  createHostedDeepSeekOneShotProductionExecutor,
  createHostedDeepSeekOneShotProductionSnapshotAdapter,
} from "./acceptance-hosted-deepseek-one-shot-composition.mjs";
import {
  approval,
  candidateCommit,
  deployments,
  postSnapshot,
  preSnapshot,
} from "./acceptance-hosted-deepseek-one-shot-test-fixtures.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;

test("production composition reuses the authority, session, HTTP, deployment, and evidence adapters", async () => {
  const calls = [];
  const lifecycle = {
    readStatus: async () => ({
      authority: "hosted-deepseek-one-shot",
      records: [],
    }),
  };
  const session = {
    capturePostSnapshot: undefined,
    capturePreSnapshot: undefined,
    destroySession: () => undefined,
    invokeCloudWebAnalysis: () => undefined,
    loginPassword: () => undefined,
    logout: () => undefined,
    readOperatorAuthorization: () => undefined,
    reauthenticatePassword: () => undefined,
    setModelKillSwitch: () => undefined,
  };
  const evidence = {
    readServerSettlement: () => undefined,
    reconcileDispatchedRequest: () => undefined,
  };
  const snapshot = {
    capturePostSnapshot: () => undefined,
    capturePreSnapshot: () => undefined,
  };
  const executor = createHostedDeepSeekOneShotProductionExecutor({
    credentials: { private: true },
    keyring: { private: true },
    query: async () => undefined,
    snapshot,
    factories: {
      createAuthority(options) {
        calls.push(["authority", options]);
        return lifecycle;
      },
      createEvidence(options) {
        calls.push(["evidence", options]);
        return evidence;
      },
      createExecutor(options) {
        calls.push(["executor", options]);
        return Object.freeze({
          execute: async () => ({ outcome: "accepted" }),
          recover: async () => ({ outcome: "restored" }),
          status: async () => ({ state: "absent" }),
        });
      },
      createHttpTransport(options) {
        calls.push(["http", options]);
        return { private: true };
      },
      createSessionAdapter(options) {
        calls.push(["session", options]);
        return session;
      },
    },
  });

  assert.deepEqual(Object.keys(executor).sort(), ["execute", "recover", "status"]);
  assert.equal(Object.isFrozen(executor), true);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["authority", "evidence", "http", "session", "executor"],
  );
  const adapter = calls.at(-1)[1].adapter;
  assert.equal(adapter.capturePreSnapshot, snapshot.capturePreSnapshot);
  assert.equal(adapter.capturePostSnapshot, snapshot.capturePostSnapshot);
  assert.equal(adapter.readServerSettlement, evidence.readServerSettlement);
  assert.equal(adapter.reconcileDispatchedRequest, evidence.reconcileDispatchedRequest);
  assert.equal(adapter.loginPassword, session.loginPassword);
});

test("production composition defaults perform status through Postgres authority only", async () => {
  const calls = [];
  const executor = createHostedDeepSeekOneShotProductionExecutor({
    credentials: {
      email: "operator@example.com",
      password: "fictional-password",
    },
    fetch_: async () => {
      throw new Error("status must not use HTTP");
    },
    keyring: {
      create: () => {
        throw new Error("status must not create HMAC material");
      },
      recover: () => {
        throw new Error("status must not recover HMAC material");
      },
    },
    query: async (sql, parameters, control) => {
      calls.push({ control, parameters, sql });
      return { rows: [{ state: "absent" }] };
    },
    readNowMilliseconds: () => 1_000,
    snapshot: {
      capturePostSnapshot: async () => {
        throw new Error("status must not capture post evidence");
      },
      capturePreSnapshot: async () => {
        throw new Error("status must not capture pre evidence");
      },
    },
  });

  assert.deepEqual(await executor.status(), { state: "absent" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].parameters, []);
  assert.match(calls[0].sql, /read_hosted_acceptance_status/u);
  assert.equal(calls[0].control.signal instanceof AbortSignal, true);
});

test("production execute rejects pending authority before preflight or claim mutation", async () => {
  const calls = [];
  const core = Object.freeze({
    execute: async () => {
      calls.push("core-execute");
    },
    recover: async () => undefined,
    status: async () => ({ state: "cleanup-pending" }),
  });
  const executor = createHostedDeepSeekOneShotProductionExecutor({
    credentials: {},
    keyring: {},
    query: async () => undefined,
    snapshot: {
      capturePostSnapshot: async () => calls.push("post"),
      capturePreSnapshot: async () => calls.push("pre"),
    },
    factories: {
      createAuthority: () => ({}),
      createEvidence: () => ({}),
      createExecutor: () => core,
      createHttpTransport: () => ({}),
      createSessionAdapter: () => ({}),
    },
  });

  await assert.rejects(executor.execute(approval()), failurePattern);
  await assert.rejects(executor.execute(approval(), { operationId: "opaque" }), failurePattern);
  await assert.rejects(executor.status({ operationId: "opaque" }), failurePattern);
  await assert.rejects(executor.recover({ operationId: "opaque" }), failurePattern);
  assert.deepEqual(calls, []);
});

test("production snapshot adapter fixes route and rejects candidate or deployment drift before mutation", async () => {
  const calls = [];
  const adapter = createHostedDeepSeekOneShotProductionSnapshotAdapter({
    captureDeploymentPair: async () => {
      calls.push("deployments");
      return deployments();
    },
    inspectCandidate: async () => {
      calls.push("candidate");
      return {
        branch: "codex/settings-configuration",
        clean: true,
        commit: candidateCommit,
        upstreamCommit: candidateCommit,
      };
    },
    readPostEvidence: async () => postSnapshot(),
    readPreEvidence: async () => {
      const snapshot = preSnapshot();
      return {
        authority: snapshot.authority,
        budget: snapshot.budget,
        killSwitchEnabled: snapshot.killSwitchEnabled,
        observedAt: snapshot.observedAt,
        ownerUsage: snapshot.ownerUsage,
      };
    },
    vercelToken: "fictional-vercel-token",
  });

  const snapshot = await adapter.capturePreSnapshot({ signal: new AbortController().signal });
  assert.deepEqual(snapshot.candidate, preSnapshot().candidate);
  assert.deepEqual(snapshot.deployments, deployments());
  assert.deepEqual(snapshot.route, {
    origin: "https://app.acceptance.seen-said.cn",
    path: "/analysis",
  });
  assert.deepEqual(calls, ["candidate", "deployments"]);
});
