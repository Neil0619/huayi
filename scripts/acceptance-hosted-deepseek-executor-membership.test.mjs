import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { renderHostedDeepseekExecutorMembershipContractSql } from "./acceptance-hosted-deepseek-executor-membership.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");

test("DeepSeek executor membership accepts only an optional PostgreSQL 17 creator edge", async () => {
  const database = new PGlite();
  await database.waitReady;
  try {
    await database.exec(`
      CREATE ROLE huayi_hosted_acceptance_executor NOLOGIN NOINHERIT NOBYPASSRLS;
      CREATE ROLE hosted_acceptance_membership_rogue NOLOGIN;
    `);
    const readContract = async () => {
      const result = await database.query(
        `SELECT ${renderHostedDeepseekExecutorMembershipContractSql()} AS exact`,
      );
      return result.rows[0]?.exact;
    };

    assert.equal(await readContract(), true);
    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO postgres
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    `);
    assert.equal(await readContract(), true);

    for (const [unsafeOption, restoreOption] of [
      ["ADMIN FALSE", "ADMIN TRUE"],
      ["INHERIT TRUE", "INHERIT FALSE"],
      ["SET TRUE", "SET FALSE"],
    ]) {
      await database.exec(`
        GRANT huayi_hosted_acceptance_executor TO postgres WITH ${unsafeOption};
      `);
      assert.equal(await readContract(), false);
      await database.exec(`
        GRANT huayi_hosted_acceptance_executor TO postgres WITH ${restoreOption};
      `);
      assert.equal(await readContract(), true);
    }

    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO hosted_acceptance_membership_rogue
      WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
    `);
    assert.equal(await readContract(), false);
    await database.exec(`
      REVOKE huayi_hosted_acceptance_executor FROM hosted_acceptance_membership_rogue;
      GRANT hosted_acceptance_membership_rogue TO huayi_hosted_acceptance_executor
      WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
    `);
    assert.equal(await readContract(), false);

    assert.match(renderHostedDeepseekExecutorMembershipContractSql(), /count\(\*\) <= 1/u);
  } finally {
    await database.close();
  }
});
