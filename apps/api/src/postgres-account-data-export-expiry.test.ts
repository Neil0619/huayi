import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAccountDataRightsModule } from "./account-data-rights-module.js";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { createPostgresAccountDataRights } from "./postgres-account-data-rights.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const owner = "00000000-0000-0000-0000-00000000000a";
const now = new Date("2026-08-13T01:00:00.000Z");
const pepper = "test-pepper-with-at-least-thirty-two-characters";

describe("Postgres account data export expiry", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    await database.exec(`
      INSERT INTO user_profiles(
        user_id,owner_user_id,email,status,timezone,daily_goal,extension_query_model_mode,
        study_capture_mode,cloud_word_copy_mode,preferences_revision,created_at,updated_at
      ) VALUES('${owner}','${owner}','a@example.test','active','UTC',5,'byok',
        'manual','disabled',1,'2026-08-12T00:00:00Z','2026-08-12T00:00:00Z');
    `);
  });

  afterEach(async () => database.close());

  it("clears a ready export object key only after Storage deletion", async () => {
    const adapter = createPgliteAnalysisDatabase(database);
    const rights = createAccountDataRightsModule({
      now: () => now,
      repository: createPostgresAccountDataRights(adapter, {
        id: () => "20000000-0000-4000-8000-000000000001",
        pepper,
      }),
      signedUrls: { create: async () => ({ url: "https://example.test/signed" }) },
    });
    await rights.requestExport(owner, "create-expiring-export", {});
    const deletedObjects: string[][] = [];
    const worker = createAccountDataRightsWorker({
      authority: {
        deleteAuthUser: async () => undefined,
        deleteObjects: async (keys) => {
          deletedObjects.push(keys);
        },
        upload: async () => undefined,
      },
      exportSource: { records: async () => [] },
      now: () => now,
      repository: createPostgresAccountDataRightsWorker(adapter, {
        clock: new MutableClock(now.toISOString()),
        pepper,
        secrets: new DeterministicSecrets(),
      }),
    });

    await expect(worker.runOne()).resolves.toEqual({ deletion: "idle", export: "processed" });
    await database.exec(
      "UPDATE account_data_export_jobs SET expires_at=now()-interval '1 second' WHERE state='ready'",
    );
    await expect(worker.runOne()).resolves.toEqual({ deletion: "idle", export: "processed" });

    expect(deletedObjects).toEqual([[expect.stringMatching(/^account-exports\/.+\.ndjson$/u)]]);
    expect(
      (
        await database.query<{
          last_error_code: string | null;
          object_key: string | null;
          state: string;
        }>("SELECT state,object_key,last_error_code FROM account_data_export_jobs")
      ).rows,
    ).toEqual([{ last_error_code: null, object_key: null, state: "expired" }]);
  });
});
