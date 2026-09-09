import { readdir } from "node:fs/promises";

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCurrentDatabaseFixture,
  currentMigrationNames,
} from "./test-support/current-database-fixture.js";

describe("Cloud V1 current migration chain", () => {
  let database: PGlite | undefined;

  afterEach(async () => database?.close());

  it("applies the current baseline followed by every forward migration", async () => {
    expect(
      (await readdir(new URL("../migrations/", import.meta.url)))
        .filter((name) => /^\d{4}-.+\.sql$/u.test(name))
        .sort(),
    ).toEqual([...currentMigrationNames]);
    database = await createCurrentDatabaseFixture();
    for (const signature of [
      "read_password_signup_state(text)",
      "compare_password_signup_state(text,text,text)",
      "release_password_recovery_completion(text,text,timestamptz)",
    ]) {
      expect(
        (
          await database.query(
            "SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service_role",
            [signature],
          )
        ).rows,
      ).toEqual([{ anon: false, authenticated: false, service_role: false }]);
    }
  });
});
