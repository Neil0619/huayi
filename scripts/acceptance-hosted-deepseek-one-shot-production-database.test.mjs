import assert from "node:assert/strict";
import test from "node:test";

import { createHostedDeepSeekProductionDatabase } from "./acceptance-hosted-deepseek-one-shot-production-database.mjs";

function fakeSql() {
  const calls = [];
  const transaction = {
    unsafe(text, parameters = []) {
      calls.push(["unsafe", text, parameters]);
      const result = Promise.resolve([{ value: "ok" }]);
      result.cancel = () => calls.push(["cancel"]);
      return result;
    },
  };
  const sql = {
    async begin(operation) {
      calls.push(["begin"]);
      return operation(transaction);
    },
    async end(options) {
      calls.push(["end", options]);
    },
  };
  return { calls, sql };
}

test("production database keeps the password in memory and fences read versus fixed authority SQL", async () => {
  const { calls, sql } = fakeSql();
  const connections = [];
  const password = "fictional-administrator-password";
  const database = createHostedDeepSeekProductionDatabase({
    administratorPassword: password,
    caCertificate:
      "-----BEGIN CERTIFICATE-----\nfictional-ca-material-that-is-long-enough-for-validation-0001\n-----END CERTIFICATE-----",
    connect: (url, options) => {
      connections.push({ options, url });
      return sql;
    },
  });

  assert.equal(connections.length, 1);
  assert.equal(new URL(connections[0].url).password, "");
  assert.equal(connections[0].options.password, password);
  assert.equal(connections[0].options.max, 1);
  assert.equal(connections[0].options.prepare, false);
  assert.equal(JSON.stringify(connections).includes(`:${password}@`), false);

  assert.deepEqual(
    await database.executorQuery(
      'SELECT huayi_private.read_hosted_acceptance_status() AS "state"',
      [],
    ),
    {
      rows: [{ value: "ok" }],
    },
  );
  const beginCount = calls.filter((call) => call[0] === "begin").length;
  await assert.rejects(
    database.executorQuery("SELECT 1", []),
    /^Error: Hosted Cloud Web DeepSeek production database failed closed\.$/u,
  );
  await assert.rejects(
    database.executorQuery("SELECT huayi_private.read_hosted_acceptance_status(); SELECT 1", []),
    /^Error: Hosted Cloud Web DeepSeek production database failed closed\.$/u,
  );
  assert.equal(calls.filter((call) => call[0] === "begin").length, beginCount);
  assert.deepEqual(await database.administratorReadQuery("SELECT 1", []), {
    rows: [{ value: "ok" }],
  });
  await database.close();

  assert.equal(
    calls.some(
      (call) =>
        call[0] === "unsafe" && /SET LOCAL ROLE huayi_hosted_acceptance_executor/u.test(call[1]),
    ),
    false,
  );
  assert.equal(
    calls.some((call) => call[0] === "unsafe" && call[1] === "SET TRANSACTION READ ONLY"),
    true,
  );
  assert.deepEqual(calls.at(-1), ["end", { timeout: 5 }]);
});

test("production database cancels an in-flight statement when the supplied control aborts", async () => {
  const calls = [];
  let resolveStatement;
  const statement = new Promise((resolve) => {
    resolveStatement = resolve;
  });
  statement.cancel = () => {
    calls.push("cancel");
    resolveStatement([]);
  };
  const database = createHostedDeepSeekProductionDatabase({
    administratorPassword: "fictional-administrator-password",
    caCertificate:
      "-----BEGIN CERTIFICATE-----\nfictional-ca-material-that-is-long-enough-for-validation-0001\n-----END CERTIFICATE-----",
    connect: () => ({
      begin: async (operation) =>
        operation({
          unsafe(text) {
            if (text.startsWith("SET ")) return Promise.resolve([]);
            return statement;
          },
        }),
      end: async () => undefined,
    }),
  });
  const controller = new AbortController();
  const query = database.executorQuery(
    'SELECT huayi_private.read_hosted_acceptance_status() AS "state"',
    [],
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(
    query,
    /^Error: Hosted Cloud Web DeepSeek production database failed closed\.$/u,
  );
  assert.deepEqual(calls, ["cancel"]);
});
