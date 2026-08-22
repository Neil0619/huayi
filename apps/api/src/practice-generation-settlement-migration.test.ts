import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL(
  "../migrations/0005-practice-generation-settlement.sql",
  import.meta.url,
);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260821040000_practice_generation_settlement.sql",
  import.meta.url,
);

describe("practice generation settlement migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const [apiMigration, supabaseMigration] = await Promise.all([
      readFile(forwardUrl, "utf8"),
      readFile(supabaseForwardUrl, "utf8"),
    ]);
    expect(supabaseMigration).toEqual(apiMigration);
  });

  it("keeps practice quota settlement context-setter-only after forward replay", async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(baselineUrl, "utf8"));
    await database.exec(await readFile(forwardUrl, "utf8"));

    const privileges = await database.query<{
      business: boolean;
      context_setter: boolean;
      public_role: boolean;
    }>(`SELECT
      has_function_privilege('huayi_business',
        'settle_practice_generation_quota(uuid,uuid,uuid,uuid[],jsonb,text,timestamptz)',
        'EXECUTE') business,
      has_function_privilege('huayi_context_setter',
        'settle_practice_generation_quota(uuid,uuid,uuid,uuid[],jsonb,text,timestamptz)',
        'EXECUTE') context_setter,
      has_function_privilege('public',
        'settle_practice_generation_quota(uuid,uuid,uuid,uuid[],jsonb,text,timestamptz)',
        'EXECUTE') public_role`);

    expect(privileges.rows).toEqual([
      { business: false, context_setter: true, public_role: false },
    ]);
  });
});
