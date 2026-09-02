import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedDeepSeekApplicationBudgetMilliseconds,
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekPreflightBudgetMilliseconds,
  hostedDeepSeekRecoveryEvidenceBudgetMilliseconds,
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
  renderHostedDeepSeekOneShotPlan,
  runHostedDeepSeekOneShotCli,
} from "./acceptance-hosted-deepseek-one-shot.mjs";

test("DeepSeek plan is fixed, zero-I/O, Cloud-Web-only, and does not instantiate production", async () => {
  let stdout = "";
  let stderr = "";
  const privateValue = "sk-private-must-not-appear";
  const code = await runHostedDeepSeekOneShotCli({
    arguments_: ["plan"],
    environment: { DEEPSEEK_API_KEY: privateValue },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, renderHostedDeepSeekOneShotPlan());
  assert.match(stdout, /zero filesystem \/ zero Git \/ zero network \/ zero Hosted write/u);
  assert.match(stdout, new RegExp(`${hostedDeepSeekWebOrigin}${hostedDeepSeekWebPath}`, "u"));
  for (const expected of [
    "Classic `pnpm smoke:deepseek` is forbidden",
    "production composition root reuses the reviewed private Postgres authority/evidence",
    "Plan never creates that root or performs I/O",
    "only caller seam is status(), execute(approval), and recover()",
    "read-only authority query with an absolute five-second bound",
    "Approval contains only the candidate commit, exact confirmation, and reservation cap",
    "authority generates operation and idempotency identities",
    "independently attested full source SHAs",
    "session-free pre-snapshot",
    "preflight owns one absolute 10-second envelope",
    "independent five-second bound",
    "Invalid preflight or claim performs zero login and zero logout",
    "one absolute 10-second session-establishment envelope",
    "durably arm a reclaimable cleanup lease",
    "90-second application, 10-second cleanup, and independent 10-second logout windows",
    "server-authoritative armedAt plus 120 seconds",
    "persist dispatch-attempted",
    "bind that server-generated request ID",
    "bounded fenced SQL reconciliation by the authority-owned idempotency key, owner, and fixed payload digest",
    "Reconcile and bind exactly one match atomically",
    "never POST again",
    "never accepts an opaque operation ID",
    "absolute 90-second deadline",
    "separate absolute 20-second reconciliation/settlement evidence envelope",
    "caller-selected receipt digests are forbidden",
    "Application abort cannot suppress logout",
    "before durable cleanup completion and operation terminalization",
    "continuous zero-based UsageLedger calls",
    "exposes no opaque IDs, price UUID, or token-usage details",
  ]) {
    assert.match(stdout, new RegExp(expected.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(stdout, /adapter control only; never Web request body or Provider parameters/u);
  assert.doesNotMatch(stdout, new RegExp(privateValue, "u"));
  assert.equal(hostedDeepSeekApplicationBudgetMilliseconds, 90_000);
  assert.equal(hostedDeepSeekPreflightBudgetMilliseconds, 10_000);
  assert.equal(hostedDeepSeekRecoveryEvidenceBudgetMilliseconds, 20_000);

  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:plan"],
    "node scripts/acceptance-hosted-deepseek-one-shot-cli.mjs plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:status"],
    "node scripts/acceptance-hosted-deepseek-one-shot-cli.mjs status",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:execute"],
    "node scripts/acceptance-hosted-deepseek-one-shot-cli.mjs execute",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:recover"],
    "node scripts/acceptance-hosted-deepseek-one-shot-cli.mjs recover",
  );
});

test("default CLI fails closed on every non-plan argument without external work", async () => {
  for (const arguments_ of [
    [],
    ["status"],
    ["recover"],
    ["execute", "1".repeat(40), "500", hostedDeepSeekOneShotConfirmation],
    ["run"],
    ["run", hostedDeepSeekOneShotConfirmation],
    ["plan", "extra"],
  ]) {
    let stdout = "";
    let stderr = "";
    const code = await runHostedDeepSeekOneShotCli({
      arguments_,
      environment: { TOKEN: "private-token" },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.deepEqual(
      { code, stderr, stdout },
      {
        code: 1,
        stderr: "Hosted Cloud Web DeepSeek one-shot failed closed.\n",
        stdout: "",
      },
    );
  }
});
