import type { PGlite } from "@electric-sql/pglite";
import type { AccountDataExportRecordRead } from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import {
  createAccountDataRightsWorker,
  type AccountDataRightsWorkerRepository,
} from "./account-data-rights-worker.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { createSupabaseAccountDataAuthority } from "./supabase-account-data-authority.js";
import { createAccountDataRightsModule } from "./account-data-rights-module.js";
import { createPostgresAccountDataRights } from "./postgres-account-data-rights.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const owner = "00000000-0000-0000-0000-000000000001";
const exportId = "10000000-0000-4000-8000-000000000001";
let database: PGlite;
beforeEach(async () => {
  database = await createCurrentDatabaseFixture();
  await database.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'offline@example.test','active','UTC',5)",
    [owner],
  );
  await database.query(
    "INSERT INTO account_data_export_jobs(id,owner_user_id,state,format_version) VALUES($1,$2,'pending',2)",
    [exportId, owner],
  );
});
afterEach(async () => database.close());

function barrier() {
  let resolve: () => void = () => {
    throw new Error("Barrier is not initialized.");
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const objects = new Map<string, Uint8Array>();
  const clock = new MutableClock(new Date().toISOString());
  const repository = createPostgresAccountDataRightsWorker(createPgliteAnalysisDatabase(database), {
    clock,
    pepper: "offline-fixture-pepper",
    secrets: new DeterministicSecrets(),
  });
  const authority = createSupabaseAccountDataAuthority({
    supabaseUrl: "https://storage.example",
    bucket: "private",
    client: {
      auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } },
      storage: {
        from: () => ({
          createSignedUrl: vi.fn(),
          upload: async (key, body, options) => {
            expect(options.upsert).toBe(false);
            if (objects.has(key)) return { error: new Error("Duplicate object") };
            objects.set(key, new Uint8Array(body));
            return { error: null };
          },
          remove: async (keys) => {
            for (const key of keys) objects.delete(key);
            return { error: null };
          },
        }),
      },
    },
  });
  const worker = (
    store: AccountDataRightsWorkerRepository = repository,
    records: () => Promise<AccountDataExportRecordRead[]> = async () => [],
  ) =>
    createAccountDataRightsWorker({
      authority,
      repository: store,
      exportSource: { records },
      now: () => clock.now(),
    });
  const published = async () => {
    const row = (
      await database.query<{ state: string; object_key: string; sha256: string }>(
        "SELECT state,object_key,sha256 FROM account_data_export_jobs WHERE id=$1",
        [exportId],
      )
    ).rows[0];
    if (!row) throw new Error("Missing export job");
    expect(row.state).toBe("ready");
    const bytes = objects.get(row.object_key);
    expect(bytes).toBeDefined();
    if (!bytes) throw new Error("Published object was deleted");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(row.sha256);
    return row;
  };
  return { objects, repository, worker, published, authority };
}

describe("durable account export object publication", () => {
  it("preserves full data export rights for a disabled account", async () => {
    await database.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [owner]);
    const { worker, published } = setup();
    const source = createPostgresAccountDataExportSource(createPgliteAnalysisDatabase(database));
    expect(
      await worker(undefined, () => source.records(owner, new Date().toISOString())).runOne(),
    ).toEqual({ deletion: "idle", export: "processed" });
    await published();
    expect(
      (
        await database.query("SELECT record_count FROM account_data_export_jobs WHERE id=$1", [
          exportId,
        ])
      ).rows,
    ).toEqual([{ record_count: 3 }]);
  });
  it.each([false, true])(
    "reclaims an uncertain late upload after cleanup, including deleted account=%s",
    async (deleteAccount) => {
      const { worker, repository, authority, objects, published } = setup();
      const stale = await repository.claimExport();
      if (!stale) throw new Error("Missing claim");
      await repository.prepareExportUpload(stale);
      if (deleteAccount) {
        const rights = createAccountDataRightsModule({
          now: () => new Date(),
          signedUrls: authority.signedUrls,
          repository: createPostgresAccountDataRights(createPgliteAnalysisDatabase(database), {
            id: () => crypto.randomUUID(),
            pepper: "offline-fixture-pepper",
          }),
        });
        await rights.requestDeletion(owner, "delete", "session", new Date(), {
          confirmation: "delete-account",
        });
        expect(await worker().runOne()).toMatchObject({ deletion: "processed" });
        expect((await database.query("SELECT * FROM user_profiles")).rows).toEqual([]);
      } else {
        await database.query(
          "UPDATE account_data_export_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
          [exportId],
        );
        expect(await worker().runOne()).toMatchObject({ export: "processed" });
        await published();
      }
      // A previously transmitted request reaches Storage after removal. Its process has
      // crashed, so there is deliberately no complete/failure/finally cleanup callback.
      await authority.upload(stale.objectKey, new TextEncoder().encode("private late snapshot"));
      expect(objects.has(stale.objectKey)).toBe(true);
      expect(
        (
          await database.query(
            "SELECT export_id,lease_hash,retired FROM huayi_private.account_export_candidates WHERE object_key=$1",
            [stale.objectKey],
          )
        ).rows,
      ).toEqual([{ export_id: null, lease_hash: null, retired: true }]);
      await database.query(
        "UPDATE huayi_private.account_export_candidates SET next_cleanup_at=now()-interval '1 second' WHERE object_key=$1",
        [stale.objectKey],
      );
      expect(await worker().runOne()).toMatchObject({ export: "processed" });
      expect(objects.has(stale.objectKey)).toBe(false);
      if (deleteAccount) expect(objects.size).toBe(0);
      else await published();
    },
  );
  it("keeps the successor's published bytes when an expired worker resumes late", async () => {
    const { worker, published, objects } = setup();
    const entered = barrier();
    const resume = barrier();
    const old = worker(undefined, async () => {
      entered.resolve();
      await resume.promise;
      return [];
    })
      .runOne()
      .catch((error: unknown) => error);
    await entered.promise;
    await database.query(
      "UPDATE account_data_export_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
      [exportId],
    );
    expect(await worker().runOne()).toEqual({ deletion: "idle", export: "processed" });
    const before = await published();
    resume.resolve();
    await old;
    expect(await published()).toEqual(before);
    expect(objects.size).toBe(1);
  });

  it("reconciles a committed publication whose reply was lost before deleting anything", async () => {
    const { repository, worker, published, objects } = setup();
    const response = await worker({
      ...repository,
      completeExport: async (command) => {
        await repository.completeExport(command);
        throw new Error("Simulated lost commit reply");
      },
    })
      .runOne()
      .catch((error: unknown) => error);
    await published();
    expect(response).toEqual({ deletion: "idle", export: "processed" });
    expect(objects.size).toBe(1);
  });
});
