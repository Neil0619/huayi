import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const ownerUserId = "00000000-0000-0000-0000-00000000000a";

describe("transaction owner context", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => database.close());

  it("does not retain owner context after the setting transaction commits", async () => {
    await database.transaction(async (transaction) => {
      await transaction.exec(`SELECT huayi_private.set_owner_context('${ownerUserId}')`);
      await transaction.exec("SET LOCAL ROLE huayi_business");
      const owner = await transaction.query<{ owner: string }>(
        "SELECT huayi_private.current_owner_user_id()::text AS owner",
      );
      expect(owner.rows).toEqual([{ owner: ownerUserId }]);
    });

    await database.transaction(async (transaction) => {
      await transaction.exec("SET LOCAL ROLE huayi_business");
      const owner = await transaction.query<{ owner: string | null }>(
        "SELECT huayi_private.current_owner_user_id()::text AS owner",
      );
      expect(owner.rows).toEqual([{ owner: null }]);
    });
  });
});
