import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAccountProfile } from "./postgres-account-profile.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres current account profile", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async snapshot(ownerUserId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
          return operation({
            tenant: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_business");
                return query(transaction).rows(text, parameters);
              },
            },
            trusted: query(transaction),
          });
        });
      },
      async transaction(ownerUserId, operation) {
        return this.snapshot?.(ownerUserId, operation) as ReturnType<typeof operation>;
      },
      async trusted(operation) {
        return operation(query(database));
      },
    };
    await database.exec(`INSERT INTO user_profiles(
      user_id,owner_user_id,email,status,timezone,daily_goal,extension_query_model_mode,
      study_capture_mode,cloud_word_copy_mode,preferences_revision,updated_at
    ) VALUES
      ('${userA}','${userA}','a@example.test','active','Asia/Shanghai',6,'byok','automatic',
       'disabled',4,'2026-08-13T10:00:00.000Z'),
      ('${userB}','${userB}','b@example.test','active','UTC',3,'platform','manual',
       'enabled',1,'2026-08-13T09:00:00.000Z');
    INSERT INTO extension_sessions(
      id,user_id,owner_user_id,install_id_hash,token_hash,device_label,last_used_at,expires_at,
      revoked_at,created_at
    ) VALUES
      ('10000000-0000-4000-8000-000000000002','${userA}','${userA}','hash-a2','token-a2',
       'Second','2026-08-13T12:00:00.000Z','2099-11-11T10:00:00.000Z',NULL,
       '2026-08-13T11:00:00.000Z'),
      ('10000000-0000-4000-8000-000000000001','${userA}','${userA}','hash-a1','token-a1',
       'First',NULL,'2099-11-11T10:00:00.000Z',NULL,'2026-08-13T10:00:00.000Z'),
      ('10000000-0000-4000-8000-000000000003','${userA}','${userA}','hash-a3','token-a3',
       'Revoked',NULL,'2099-11-11T10:00:00.000Z','2026-08-13T12:00:00.000Z',
       '2026-08-13T09:00:00.000Z'),
      ('10000000-0000-4000-8000-000000000004','${userA}','${userA}','hash-a4','token-a4',
       'Expired',NULL,'2020-11-11T10:00:00.000Z',NULL,'2026-08-13T08:00:00.000Z'),
      ('20000000-0000-4000-8000-000000000001','${userB}','${userB}','hash-b1','token-b1',
       'Other owner',NULL,'2099-11-11T10:00:00.000Z',NULL,'2026-08-13T07:00:00.000Z');`);
  });

  afterEach(async () => database.close());

  it("returns one strict owner snapshot with complete preferences and sorted active sessions", async () => {
    const profile = createPostgresAccountProfile({
      database: adapter,
      minSupportedExtensionVersion: "1.0.0",
    });

    await expect(profile.read(userA)).resolves.toEqual({
      email: "a@example.test",
      extensionSessions: [
        {
          createdAt: "2026-08-13T10:00:00.000Z",
          deviceLabel: "First",
          expiresAt: "2099-11-11T10:00:00.000Z",
          id: "10000000-0000-4000-8000-000000000001",
          lastUsedAt: null,
        },
        {
          createdAt: "2026-08-13T11:00:00.000Z",
          deviceLabel: "Second",
          expiresAt: "2099-11-11T10:00:00.000Z",
          id: "10000000-0000-4000-8000-000000000002",
          lastUsedAt: "2026-08-13T12:00:00.000Z",
        },
      ],
      minSupportedExtensionVersion: "1.0.0",
      preferences: {
        cloudWordCopyMode: "disabled",
        dailyGoal: 6,
        extensionQueryModelMode: "byok",
        revision: 4,
        studyCaptureMode: "automatic",
        timezone: "Asia/Shanghai",
        updatedAt: "2026-08-13T10:00:00.000Z",
      },
    });
    await expect(
      database.query<{ last_used_at: string | null }>(
        "SELECT last_used_at::text FROM extension_sessions WHERE token_hash='token-a1'",
      ),
    ).resolves.toMatchObject({ rows: [{ last_used_at: null }] });
  });

  it("does not expose another owner and rejects a missing profile", async () => {
    const profile = createPostgresAccountProfile({
      database: adapter,
      minSupportedExtensionVersion: "1.0.0",
    });
    await expect(profile.read(userB)).resolves.toMatchObject({
      email: "b@example.test",
      extensionSessions: [{ deviceLabel: "Other owner" }],
    });
    await database.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [userB]);
    await expect(profile.read(userB)).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.read("00000000-0000-0000-0000-00000000000c")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
