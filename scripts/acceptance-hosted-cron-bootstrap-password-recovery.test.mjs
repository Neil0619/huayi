import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deliverHostedPasswordRecovery,
  hostedCronPasswordRecoveryConfirmation,
  hostedCronProvisionConfirmation,
  provisionHostedCronSecret,
  renderHostedCronBootstrapPlan,
  runHostedCronBootstrapCli,
} from "./acceptance-hosted-cron-bootstrap.mjs";

const administratorPassword = "administrator-password";
const caCertificate = `-----BEGIN CERTIFICATE-----
${"A".repeat(80)}
-----END CERTIFICATE-----`;
const cronSecret = "a".repeat(64);
const vercelToken = "fictional-vercel-token";

function emptyR3cSnapshot() {
  return {
    cron_acl_exact: "f",
    cron_extensions_exact: "f",
    cron_function_contract_exact: "f",
    cron_jobs_exact: "f",
    cron_vault_names_exact: "f",
    r3c_claimable: "0",
    r3c_contract_exact: "t",
    r3c_dead_letter: "0",
    r3c_failed: "0",
    r3c_max_attempts: "0",
    r3c_overdue_nonterminal: "0",
    r3c_pending: "0",
    r3c_sending: "0",
    r3c_sent: "0",
    r3c_total: "0",
  };
}

function recoverySnapshot(overrides = {}) {
  return {
    password_recovery_ambiguous: "0",
    password_recovery_claimable: "1",
    password_recovery_open_total: "1",
    password_recovery_sent: "0",
    ...overrides,
  };
}

function absentCronStatus() {
  return {
    cron_fixed_jobs_count: "0",
    cron_function_contract_exact: "f",
    cron_installation_state: "absent",
    cron_jobs_exact: "f",
    cron_unmanaged_jobs_count: "0",
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function sharedDependencies() {
  const credentialCalls = [];
  const releaseCalls = [];
  return {
    credentialCalls,
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readCredential: async (credentialId) => {
      credentialCalls.push(credentialId);
      if (credentialId === "supabase-admin-db-password") return administratorPassword;
      if (credentialId === "vercel-token") return vercelToken;
      throw new Error("Unexpected credential.");
    },
    readCronStatus: async () => absentCronStatus(),
    releaseCalls,
    releaseGate: {
      async attestCompleted() {
        releaseCalls.push("attest");
      },
      async provision(operation) {
        releaseCalls.push("provision");
        return operation();
      },
    },
    runSnapshotQuery: async () => emptyR3cSnapshot(),
    verifyRepositoryCandidate: async () => true,
  };
}

function vercelFetch() {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/v2/teams") {
      return json({
        pagination: { count: 1, next: null },
        teams: [{ id: "team_acceptance", name: "neil0619's projects", slug: "neil0619s-projects" }],
      });
    }
    if (url.pathname === "/v9/projects/seen-said-acceptance-api") {
      return json({
        accountId: "team_acceptance",
        id: "prj_acceptance_api",
        name: "seen-said-acceptance-api",
      });
    }
    if (url.pathname === "/v10/projects/seen-said-acceptance-api/env") {
      if (init.method === "POST") {
        return json(
          {
            created: {
              gitBranch: null,
              id: "env_cron_secret",
              key: "CRON_SECRET",
              target: ["production"],
              type: "sensitive",
              value: "",
            },
            failed: [],
          },
          201,
        );
      }
      return json({
        envs: [
          {
            gitBranch: null,
            id: "env_cron_secret",
            key: "CRON_SECRET",
            target: ["production"],
            type: "sensitive",
          },
        ],
      });
    }
    throw new Error("Unexpected Vercel URL.");
  };
}

test("provision accepts one claimable password recovery before R3-C exists", async () => {
  const dependencies = sharedDependencies();
  const result = await provisionHostedCronSecret({
    arguments_: ["provision", hostedCronProvisionConfirmation],
    ...dependencies,
    fetch_: vercelFetch(),
    runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
    runRecoverySnapshotQuery: async () => recoverySnapshot(),
  });

  assert.deepEqual(result, { outcome: "provisioned" });
  assert.deepEqual(dependencies.credentialCalls, ["supabase-admin-db-password", "vercel-token"]);
  assert.deepEqual(dependencies.releaseCalls, ["provision"]);
});

test("provision rejects prior release evidence before Vault or Vercel writes", async () => {
  let externalCalls = 0;
  await assert.rejects(
    provisionHostedCronSecret({
      arguments_: ["provision", hostedCronProvisionConfirmation],
      environment: {},
      fetch_: async () => {
        externalCalls += 1;
        throw new Error("must not fetch");
      },
      fetchCaCertificate: async () => {
        externalCalls += 1;
        throw new Error("must not fetch CA");
      },
      readCredential: async () => {
        externalCalls += 1;
        throw new Error("must not read credentials");
      },
      releaseGate: {
        async provision() {
          throw new Error("old complete release");
        },
      },
      runPsql: async () => {
        externalCalls += 1;
        throw new Error("must not connect");
      },
      verifyRepositoryCandidate: async () => true,
    }),
    /stage: release/u,
  );
  assert.equal(externalCalls, 0);
});

test("password-recovery delivery uses the Vault source and proves sent then idle", async () => {
  const dependencies = sharedDependencies();
  const fetchCalls = [];
  const recoverySnapshots = [
    recoverySnapshot(),
    recoverySnapshot({ password_recovery_claimable: "0", password_recovery_sent: "1" }),
  ];
  const result = await deliverHostedPasswordRecovery({
    arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
    ...dependencies,
    fetch_: async (input, init) => {
      fetchCalls.push({ init, url: String(input) });
      return json({ outcome: fetchCalls.length === 1 ? "sent" : "idle" });
    },
    runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
    runRecoverySnapshotQuery: async () => recoverySnapshots.shift(),
  });

  assert.deepEqual(result, { outcome: "recovery-delivered" });
  assert.deepEqual(dependencies.credentialCalls, ["supabase-admin-db-password"]);
  assert.deepEqual(dependencies.releaseCalls, ["attest"]);
  assert.equal(fetchCalls.length, 2);
  for (const call of fetchCalls) {
    assert.equal(call.url, "https://api.acceptance.seen-said.cn/internal/password-recovery/run");
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.headers.Authorization, `Bearer ${cronSecret}`);
  }
});

test("password-recovery delivery rejects release evidence before Vault or worker I/O", async () => {
  let externalCalls = 0;
  await assert.rejects(
    deliverHostedPasswordRecovery({
      arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
      environment: {},
      fetch_: async () => {
        externalCalls += 1;
        throw new Error("must not fetch");
      },
      fetchCaCertificate: async () => {
        externalCalls += 1;
        throw new Error("must not fetch CA");
      },
      readCredential: async () => {
        externalCalls += 1;
        throw new Error("must not read credentials");
      },
      releaseGate: {
        async attestCompleted() {
          throw new Error("missing, incomplete, or mismatched release");
        },
      },
      runPsql: async () => {
        externalCalls += 1;
        throw new Error("must not connect");
      },
      verifyRepositoryCandidate: async () => true,
    }),
    /stage: release/u,
  );
  assert.equal(externalCalls, 0);
});

test("password-recovery delivery treats an already-sent flow as one idle-only probe", async () => {
  const dependencies = sharedDependencies();
  let fetchCalls = 0;
  const sent = recoverySnapshot({
    password_recovery_claimable: "0",
    password_recovery_sent: "1",
  });
  const result = await deliverHostedPasswordRecovery({
    arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
    ...dependencies,
    fetch_: async () => {
      fetchCalls += 1;
      return json({ outcome: "idle" });
    },
    runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
    runRecoverySnapshotQuery: async () => sent,
  });

  assert.deepEqual(result, { outcome: "recovery-delivered" });
  assert.equal(fetchCalls, 1);
});

test("password-recovery delivery stops after an explicit worker failure", async () => {
  const dependencies = sharedDependencies();
  let fetchCalls = 0;

  await assert.rejects(
    deliverHostedPasswordRecovery({
      arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
      ...dependencies,
      fetch_: async () => {
        fetchCalls += 1;
        return json({ outcome: "failed" });
      },
      runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
      runRecoverySnapshotQuery: async () => recoverySnapshot(),
    }),
    /stage: password-recovery-delivery/u,
  );

  assert.equal(fetchCalls, 1);
});

test("Cron bootstrap CLI routes the recovery command and prints only a fixed result", async () => {
  const dependencies = sharedDependencies();
  const recoverySnapshots = [
    recoverySnapshot(),
    recoverySnapshot({ password_recovery_claimable: "0", password_recovery_sent: "1" }),
  ];
  let stdout = "";
  const outcomes = ["sent", "idle"];
  const code = await runHostedCronBootstrapCli({
    arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
    ...dependencies,
    fetch_: async () => json({ outcome: outcomes.shift() }),
    runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
    runRecoverySnapshotQuery: async () => recoverySnapshots.shift(),
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(
    stdout,
    "Hosted password recovery delivered once and duplicate processing was idle.\n",
  );
  assert.doesNotMatch(stdout, new RegExp(cronSecret, "u"));
});

test("password-recovery bootstrap is exposed in the fixed plan and package command", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:cron:bootstrap:recovery:deliver"],
    "node scripts/acceptance-hosted-cron-bootstrap.mjs recovery",
  );
  assert.match(
    renderHostedCronBootstrapPlan(),
    /provision -> exact-SHA API release -> recovery -> user password reset -> deliver -> user inbox confirmation -> Cron apply/u,
  );
});

test("password-recovery delivery rejects absent or ambiguous work before reading Vault", async () => {
  for (const snapshot of [
    recoverySnapshot({
      password_recovery_claimable: "0",
      password_recovery_open_total: "0",
    }),
    recoverySnapshot({
      password_recovery_ambiguous: "1",
      password_recovery_claimable: "0",
    }),
  ]) {
    const dependencies = sharedDependencies();
    let externalCalls = 0;
    await assert.rejects(
      deliverHostedPasswordRecovery({
        arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
        ...dependencies,
        fetch_: async () => {
          externalCalls += 1;
          throw new Error("must not fetch");
        },
        runPsql: async () => {
          externalCalls += 1;
          return { code: 0, stderr: "", stdout: `${cronSecret}\n` };
        },
        runRecoverySnapshotQuery: async () => snapshot,
      }),
      /stage: password-recovery-pending/u,
    );
    assert.equal(externalCalls, 0);
  }
});

test("password-recovery delivery rejects inherited secrets before I/O and never reflects failures", async () => {
  let calls = 0;
  let stderr = "";
  const inheritedCode = await runHostedCronBootstrapCli({
    arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
    environment: { PGPASSWORD: "private-password" },
    fetchCaCertificate: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
    readCredential: async () => {
      calls += 1;
      throw new Error("must not read");
    },
    writeError: (value) => {
      stderr += value;
    },
  });

  assert.equal(inheritedCode, 1);
  assert.equal(calls, 0);
  assert.equal(stderr, "Hosted Cron bootstrap failed at stage: credentials.\n");
  assert.doesNotMatch(stderr, /private-password/u);

  const dependencies = sharedDependencies();
  stderr = "";
  const deliveryCode = await runHostedCronBootstrapCli({
    arguments_: ["recovery", hostedCronPasswordRecoveryConfirmation],
    ...dependencies,
    fetch_: async () => new Response("private-provider-error", { status: 503 }),
    runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
    runRecoverySnapshotQuery: async () => recoverySnapshot(),
    writeError: (value) => {
      stderr += value;
    },
  });

  assert.equal(deliveryCode, 1);
  assert.equal(stderr, "Hosted Cron bootstrap failed at stage: password-recovery-delivery.\n");
  assert.doesNotMatch(stderr, /private-provider-error/u);
  assert.doesNotMatch(stderr, new RegExp(cronSecret, "u"));
});
