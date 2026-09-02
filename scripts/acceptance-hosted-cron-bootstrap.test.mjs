import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedCronDeliverConfirmation,
  hostedCronProvisionConfirmation,
  provisionHostedCronSecret,
  deliverHostedR3cNotification,
  renderHostedCronBootstrapPlan,
  runHostedCronBootstrapCli,
} from "./acceptance-hosted-cron-bootstrap.mjs";

const administratorPassword = "administrator-password";
const caCertificate = `-----BEGIN CERTIFICATE-----
${"A".repeat(80)}
-----END CERTIFICATE-----`;
const cronSecret = "a".repeat(64);
const vercelToken = "fictional-vercel-token";

function pendingSnapshot(overrides = {}) {
  return {
    cron_acl_exact: "f",
    cron_extensions_exact: "f",
    cron_function_contract_exact: "f",
    cron_jobs_exact: "f",
    cron_vault_names_exact: "f",
    r3c_claimable: "1",
    r3c_contract_exact: "t",
    r3c_dead_letter: "0",
    r3c_failed: "0",
    r3c_max_attempts: "0",
    r3c_overdue_nonterminal: "0",
    r3c_pending: "1",
    r3c_sending: "0",
    r3c_sent: "0",
    r3c_total: "1",
    ...overrides,
  };
}

function absentCronStatus(overrides = {}) {
  return {
    cron_fixed_jobs_count: "0",
    cron_function_contract_exact: "f",
    cron_installation_state: "absent",
    cron_jobs_exact: "f",
    cron_unmanaged_jobs_count: "0",
    ...overrides,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function vercelFetch(calls, { upsertResponse } = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ body: init.body, headers: init.headers, method: init.method ?? "GET", url });
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
          upsertResponse ?? {
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

function sharedDependencies() {
  const credentialCalls = [];
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
    verifyRepositoryCandidate: async () => true,
  };
}

test("Cron bootstrap plan is zero-I/O and explains the required release seam", async () => {
  let calls = 0;
  let stdout = "";
  const code = await runHostedCronBootstrapCli({
    arguments_: ["--plan"],
    environment: { VERCEL_TOKEN: "must-not-be-read" },
    fetch_: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
    readCredential: async () => {
      calls += 1;
      throw new Error("must not read");
    },
    runPsql: async () => {
      calls += 1;
      throw new Error("must not connect");
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stdout, renderHostedCronBootstrapPlan());
  assert.match(stdout, /provision -> exact-SHA API release -> deliver/u);
  assert.doesNotMatch(stdout, /must-not-be-read/u);
});

test("package scripts expose separate Cron bootstrap commands", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:cron:bootstrap:plan"],
    "node scripts/acceptance-hosted-cron-bootstrap.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:cron:bootstrap:provision"],
    "node scripts/acceptance-hosted-cron-bootstrap.mjs provision",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:cron:bootstrap:deliver"],
    "node scripts/acceptance-hosted-cron-bootstrap.mjs deliver",
  );
});

test("provision creates or reuses one Vault source and upserts Vercel without disclosure", async () => {
  const dependencies = sharedDependencies();
  const psqlCalls = [];
  const fetchCalls = [];
  const result = await provisionHostedCronSecret({
    arguments_: ["provision", hostedCronProvisionConfirmation],
    ...dependencies,
    fetch_: vercelFetch(fetchCalls),
    runPsql: async (request) => {
      psqlCalls.push(request);
      return { code: 0, stderr: "", stdout: `${cronSecret}\n` };
    },
    runSnapshotQuery: async () => pendingSnapshot({ cron_vault_names_exact: "t" }),
  });

  assert.deepEqual(result, { outcome: "provisioned" });
  assert.deepEqual(dependencies.credentialCalls, ["supabase-admin-db-password", "vercel-token"]);
  assert.equal(psqlCalls.length, 1);
  assert.equal(psqlCalls[0].captureOutput, true);
  assert.equal(psqlCalls[0].password, administratorPassword);
  assert.equal(psqlCalls[0].environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, caCertificate);
  assert.match(psqlCalls[0].input, /CREATE EXTENSION IF NOT EXISTS supabase_vault/u);
  assert.match(psqlCalls[0].input, /vault\.create_secret/u);
  assert.match(psqlCalls[0].input, /vault\.decrypted_secrets/u);
  assert.doesNotMatch(psqlCalls[0].input, new RegExp(cronSecret, "u"));
  const write = fetchCalls.find((call) => call.method === "POST");
  assert.ok(write);
  assert.deepEqual(JSON.parse(write.body), [
    {
      key: "CRON_SECRET",
      target: ["production"],
      type: "sensitive",
      value: cronSecret,
    },
  ]);
  assert.equal(write.headers.Authorization, `Bearer ${vercelToken}`);
  assert.equal(write.url.searchParams.get("upsert"), "true");
  assert.equal(fetchCalls.at(-1).method, "GET");
});

test("provision rejects a Vercel partial failure even when old metadata already exists", async () => {
  const dependencies = sharedDependencies();
  await assert.rejects(
    provisionHostedCronSecret({
      arguments_: ["provision", hostedCronProvisionConfirmation],
      ...dependencies,
      fetch_: vercelFetch([], {
        upsertResponse: {
          created: {},
          failed: [{ error: { code: "bad_request", message: cronSecret } }],
        },
      }),
      runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
      runSnapshotQuery: async () => pendingSnapshot({ cron_vault_names_exact: "t" }),
    }),
    /stage: vercel/u,
  );
});

test("provision rejects anything except one claimable R3-C notification before writes", async () => {
  for (const snapshot of [
    pendingSnapshot({ r3c_total: "0", r3c_pending: "0", r3c_claimable: "0" }),
    pendingSnapshot({ r3c_failed: "1" }),
  ]) {
    const dependencies = sharedDependencies();
    let psqlCalls = 0;
    let fetchCalls = 0;
    await assert.rejects(
      provisionHostedCronSecret({
        arguments_: ["provision", hostedCronProvisionConfirmation],
        ...dependencies,
        fetch_: async () => {
          fetchCalls += 1;
          throw new Error("must not fetch");
        },
        runPsql: async () => {
          psqlCalls += 1;
          return { code: 0, stderr: "", stdout: `${cronSecret}\n` };
        },
        runSnapshotQuery: async () => snapshot,
      }),
      /stage: r3c-pending/u,
    );
    assert.equal(psqlCalls, 0);
    assert.equal(fetchCalls, 0);
  }
});

test("provision rejects a partial or populated Cron surface before Vault writes", async () => {
  const dependencies = sharedDependencies();
  let psqlCalls = 0;
  await assert.rejects(
    provisionHostedCronSecret({
      arguments_: ["provision", hostedCronProvisionConfirmation],
      ...dependencies,
      readCronStatus: async () => absentCronStatus({ cron_installation_state: "partial" }),
      runPsql: async () => {
        psqlCalls += 1;
        return { code: 0, stderr: "", stdout: `${cronSecret}\n` };
      },
      runSnapshotQuery: async () => pendingSnapshot(),
    }),
    /stage: cron-absent/u,
  );
  assert.equal(psqlCalls, 0);
});

test("deliver uses the Vault source twice and proves sent then idle plus terminal state", async () => {
  const dependencies = sharedDependencies();
  const fetchCalls = [];
  const snapshots = [
    pendingSnapshot({ cron_vault_names_exact: "t" }),
    pendingSnapshot({
      cron_vault_names_exact: "t",
      r3c_claimable: "0",
      r3c_max_attempts: "1",
      r3c_pending: "0",
      r3c_sent: "1",
    }),
  ];
  const result = await deliverHostedR3cNotification({
    arguments_: ["deliver", hostedCronDeliverConfirmation],
    ...dependencies,
    fetch_: async (input, init) => {
      fetchCalls.push({ init, url: String(input) });
      return json({ outcome: fetchCalls.length === 1 ? "sent" : "idle" });
    },
    runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
    runSnapshotQuery: async () => snapshots.shift(),
  });

  assert.deepEqual(result, { outcome: "delivered" });
  assert.deepEqual(dependencies.credentialCalls, ["supabase-admin-db-password"]);
  assert.equal(fetchCalls.length, 2);
  for (const call of fetchCalls) {
    assert.equal(
      call.url,
      "https://api.acceptance.seen-said.cn/internal/security-notifications/run",
    );
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.headers.Authorization, `Bearer ${cronSecret}`);
  }
});

test("deliver recovery treats an already-sent notification as one idle-only probe", async () => {
  const dependencies = sharedDependencies();
  let fetchCalls = 0;
  const sentSnapshot = pendingSnapshot({
    cron_vault_names_exact: "t",
    r3c_claimable: "0",
    r3c_max_attempts: "1",
    r3c_pending: "0",
    r3c_sent: "1",
  });
  const result = await deliverHostedR3cNotification({
    arguments_: ["deliver", hostedCronDeliverConfirmation],
    ...dependencies,
    fetch_: async () => {
      fetchCalls += 1;
      return json({ outcome: "idle" });
    },
    runPsql: async () => ({ code: 0, stderr: "", stdout: `${cronSecret}\n` }),
    runSnapshotQuery: async () => sentSnapshot,
  });

  assert.deepEqual(result, { outcome: "delivered" });
  assert.equal(fetchCalls, 1);
});

test("deliver refuses a partial Cron surface before reading Vault or calling the worker", async () => {
  const dependencies = sharedDependencies();
  let externalCalls = 0;
  await assert.rejects(
    deliverHostedR3cNotification({
      arguments_: ["deliver", hostedCronDeliverConfirmation],
      ...dependencies,
      fetch_: async () => {
        externalCalls += 1;
        throw new Error("must not fetch");
      },
      readCronStatus: async () => absentCronStatus({ cron_installation_state: "partial" }),
      runPsql: async () => {
        externalCalls += 1;
        return { code: 0, stderr: "", stdout: `${cronSecret}\n` };
      },
      runSnapshotQuery: async () => pendingSnapshot({ cron_vault_names_exact: "t" }),
    }),
    /stage: cron-absent/u,
  );
  assert.equal(externalCalls, 0);
});

test("Cron bootstrap CLI exposes only a fixed failure stage", async () => {
  const privateValue = "private-cron-value";
  let stderr = "";
  const code = await runHostedCronBootstrapCli({
    arguments_: ["deliver", hostedCronDeliverConfirmation],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readCredential: async () => administratorPassword,
    readCronStatus: async () => absentCronStatus(),
    runPsql: async () => ({ code: 1, stderr: privateValue, stdout: privateValue }),
    runSnapshotQuery: async () => pendingSnapshot(),
    verifyRepositoryCandidate: async () => true,
    writeError: (value) => {
      stderr += value;
    },
  });

  assert.equal(code, 1);
  assert.match(stderr, /^Hosted Cron bootstrap failed at stage: vault-read\.\n$/u);
  assert.doesNotMatch(stderr, new RegExp(privateValue, "u"));
});
