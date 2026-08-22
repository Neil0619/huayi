import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const baselineUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const forwardUrl = new URL("../migrations/0009-account-deletion-replay.sql", import.meta.url);
const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260821080000_account_deletion_replay.sql",
  import.meta.url,
);

describe("account deletion replay migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("keeps the API and Supabase forward migrations byte-identical", async () => {
    const [apiMigration, supabaseMigration] = await Promise.all([
      readFile(forwardUrl, "utf8"),
      readFile(supabaseForwardUrl, "utf8"),
    ]);
    expect(supabaseMigration).toEqual(apiMigration);
  });

  it("replays after the current baseline without duplicating the final function", async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(baselineUrl, "utf8"));

    await expect(database.exec(await readFile(forwardUrl, "utf8"))).resolves.toBeDefined();
  });

  it("keeps account deletion replay context-setter-only after forward replay", async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(baselineUrl, "utf8"));
    await database.exec("DROP FUNCTION replay_account_deletion(text, text, text)");
    await database.exec(await readFile(forwardUrl, "utf8"));

    const privileges = await database.query<{
      business: boolean;
      context_setter: boolean;
      public_role: boolean;
    }>(`SELECT
      has_function_privilege('huayi_business',
        'replay_account_deletion(text,text,text)', 'EXECUTE') business,
      has_function_privilege('huayi_context_setter',
        'replay_account_deletion(text,text,text)', 'EXECUTE') context_setter,
      has_function_privilege('public',
        'replay_account_deletion(text,text,text)', 'EXECUTE') public_role`);

    expect(privileges.rows).toEqual([
      { business: false, context_setter: true, public_role: false },
    ]);
  });
});
