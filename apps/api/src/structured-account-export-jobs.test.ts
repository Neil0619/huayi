import type { PGlite } from "@electric-sql/pglite";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDataExportJobReadResourceSchema,
  accountDataExportRecordSchema,
  accountDataExportRecordV2Schema,
  accountDataExportRecordV3Schema,
} from "@huayi/cloud-contracts";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createAccountDataRightsModule } from "./account-data-rights-module.js";
import { createAccountDataRightsApp } from "./account-data-rights-app.js";
import { createPostgresAccountDataRights } from "./postgres-account-data-rights.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { createMiniProgramExportApp } from "./miniprogram-export-app.js";
import { insertAccountDataExportAnalysisFixture } from "./test-support/account-data-export-analysis-fixture.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";
import { MutableClock, DeterministicSecrets } from "./test-support/security-fakes.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

const owner = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
let database: PGlite;
beforeEach(async () => {
  database = await createCurrentDatabaseFixture();
  for (const id of [owner, other])
    await database.query(
      "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,$2,'active','UTC',5)",
      [id, `${id}@example.test`],
    );
});
afterEach(async () => database.close());

function setup() {
  const base = createPgliteAnalysisDatabase(database);
  // PGlite is serial; independent PostgreSQL checks cover actual snapshot isolation.
  const adapter = { ...base, snapshot: base.transaction };
  const signed = vi.fn(async (key: string) => ({
    url: `https://storage.example/storage/v1/object/sign/private/${key}?token=fixture`,
  }));
  const module = createAccountDataRightsModule({
    now: () => new Date(),
    repository: createPostgresAccountDataRights(adapter, {
      id: () => crypto.randomUUID(),
      pepper: "fixture-pepper-for-only-offline-tests",
    }),
    signedUrls: { create: signed },
  });
  const app = createAccountDataRightsApp({
    module,
    authenticate: (context) => ({
      ownerUserId: context.req.header("x-owner") ?? owner,
      reauthenticatedAt: new Date(),
      requestSessionHash: "fixture-session",
    }),
  });
  app.onError((error, context) =>
    context.json(
      { error: "rejected" },
      error instanceof CloudFault ? errorStatus(error.code) : 400,
    ),
  );
  const post = (path: string, body: unknown, key = "key", userId = owner, revision?: number) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        "x-owner": userId,
        ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
      },
      body: JSON.stringify(body),
    });
  const workerRepository = createPostgresAccountDataRightsWorker(adapter, {
    clock: new MutableClock(new Date().toISOString()),
    pepper: "fixture-pepper-for-only-offline-tests",
    secrets: new DeterministicSecrets(),
  });
  return { adapter, signed, module, app, post, workerRepository };
}

describe("durable account export format", () => {
  it("keeps a retried earlier job visible when a newer job of the same format has failed", async () => {
    const { post, app } = setup();
    const input = { formatVersion: 3 };
    const first = accountDataExportJobReadResourceSchema.parse(
      await (await post("/v1/account-data-exports", input, "first")).json(),
    );
    await database.query(
      "UPDATE account_data_export_jobs SET state='failed',last_error_code='export-build-failed' WHERE id=$1",
      [first.id],
    );
    const second = accountDataExportJobReadResourceSchema.parse(
      await (await post("/v1/account-data-exports", input, "second")).json(),
    );
    await database.query(
      "UPDATE account_data_export_jobs SET state='failed',last_error_code='export-build-failed',created_at=now()+interval '1 minute' WHERE id=$1",
      [second.id],
    );
    expect(
      (
        await post(
          `/v1/account-data-exports/${first.id}/retry`,
          { ...input, expectedRevision: 1 },
          "retry-first",
          owner,
          1,
        )
      ).status,
    ).toBe(200);
    expect(
      await (await app.request("/v1/account-data-exports/current?formatVersion=3")).json(),
    ).toMatchObject({ job: { id: first.id, state: "pending", revision: 2, formatVersion: 3 } });
  });
  it("reports a stable conflict when a failed export is retried while another format is open", async () => {
    const { post } = setup();
    const old = accountDataExportJobReadResourceSchema.parse(
      await (await post("/v1/account-data-exports", {})).json(),
    );
    await database.query(
      "UPDATE account_data_export_jobs SET state='failed',last_error_code='export-build-failed' WHERE id=$1",
      [old.id],
    );
    expect(
      (await post("/v1/account-data-exports", { formatVersion: 2 }, "new-native")).status,
    ).toBe(201);
    expect(
      (
        await post(
          `/v1/account-data-exports/${old.id}/retry`,
          { expectedRevision: 1 },
          "retry-old",
          owner,
          1,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await database.query("SELECT state,revision FROM account_data_export_jobs WHERE id=$1", [
          old.id,
        ])
      ).rows,
    ).toEqual([{ state: "failed", revision: 1 }]);
  });
  it.each([1, 2, 3] as const)(
    "keeps format %s consistent from create and replay through worker, JSON and mini download",
    async (formatVersion) => {
      const { adapter, module, signed, app, post, workerRepository } = setup();
      await insertAccountDataExportAnalysisFixture(database, owner, structuredAnalysisFixture());
      const input = formatVersion === 1 ? {} : { formatVersion };
      const createdResponse = await post("/v1/account-data-exports", input);
      expect(createdResponse.status).toBe(201);
      const created = accountDataExportJobReadResourceSchema.parse(await createdResponse.json());
      expect(created.formatVersion).toBe(formatVersion);
      expect(await (await post("/v1/account-data-exports", input)).json()).toEqual(created);
      const different = { formatVersion: formatVersion === 1 ? 2 : 1 };
      expect((await post("/v1/account-data-exports", different)).status).toBe(409);
      expect((await post("/v1/account-data-exports", different, "different-open")).status).toBe(
        409,
      );
      if (formatVersion !== 1)
        expect(
          await adapter.trusted((query) =>
            query.rows(
              "SELECT * FROM claim_account_export('legacy-worker',now()+interval '2 minutes')",
            ),
          ),
        ).toEqual([]);
      const objects = new Map<string, Uint8Array>();
      const worker = createAccountDataRightsWorker({
        now: () => new Date(),
        repository: workerRepository,
        exportSource: createPostgresAccountDataExportSource(adapter),
        authority: {
          upload: async (key, bytes) => {
            objects.set(key, bytes);
          },
          deleteObjects: vi.fn(),
          deleteAuthUser: vi.fn(),
        },
      });
      expect(await worker.runOne()).toEqual({ deletion: "idle", export: "processed" });
      const current = await (
        await app.request(`/v1/account-data-exports/current?formatVersion=${formatVersion}`)
      ).json();
      expect(current).toMatchObject({ job: { id: created.id, state: "ready", formatVersion } });
      expect((await post("/v1/account-data-exports", different, "different-ready")).status).toBe(
        409,
      );
      const objectKey = (
        await database.query<{ object_key: string }>(
          "SELECT object_key FROM account_data_export_jobs WHERE id=$1",
          [created.id],
        )
      ).rows[0]?.object_key;
      const stored = objectKey ? objects.get(objectKey) : undefined;
      if (!stored) throw new Error("Missing export object");
      const schema =
        formatVersion === 1
          ? accountDataExportRecordSchema
          : formatVersion === 2
            ? accountDataExportRecordV2Schema
            : accountDataExportRecordV3Schema;
      const records = new TextDecoder()
        .decode(stored)
        .trimEnd()
        .split("\n")
        .map((line) => schema.parse(JSON.parse(line) as unknown));
      expect(records[0]).toMatchObject({ recordType: "manifest", schemaVersion: formatVersion });
      expect(records.find((record) => record.recordType === "analysis")).toMatchObject({
        analysis: {
          result: {
            type:
              formatVersion === 1 ? "sentence-passage-analysis-v2" : "sentence-passage-analysis-v3",
          },
        },
      });
      const download = `/v1/account-data-exports/${created.id}/download-url`;
      if (formatVersion !== 1) {
        expect(await (await app.request("/v1/account-data-exports/current")).json()).toEqual({
          job: null,
        });
        expect((await post(download, {})).status).toBe(404);
        expect(signed).not.toHaveBeenCalled();
      }
      expect((await post(download, input)).status).toBe(200);
      expect((await post(download, input, "foreign-download", other)).status).toBe(404);
      const fetch = vi.fn(async () => new Response(new Uint8Array(stored)));
      const proxy = createMiniProgramExportApp({
        identity: {
          authenticate: async () => ({
            userId: owner,
            reauthenticatedAt: new Date(),
            sessionHash: "offline",
          }),
        },
        module,
        bucket: "private",
        storageOrigin: "https://storage.example",
        fetch,
      });
      proxy.onError((error, context) =>
        context.json(
          { error: "rejected" },
          error instanceof CloudFault ? errorStatus(error.code) : 400,
        ),
      );
      const headers = { authorization: `HuayiMiniProgram ${"x".repeat(43)}` };
      const path = `/v1/miniprogram/data-exports/${created.id}/content`;
      if (formatVersion !== 1) {
        expect((await proxy.request(path, { headers })).status).toBe(404);
        expect(fetch).not.toHaveBeenCalled();
      }
      const response = await proxy.request(`${path}?formatVersion=${formatVersion}`, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(stored);
      expect(
        (await database.query("SELECT format_version FROM account_data_export_jobs")).rows,
      ).toEqual([{ format_version: formatVersion }]);
    },
  );

  it.each([2, 3] as const)(
    "retries format %s only with matching format, revision and owner",
    async (formatVersion) => {
      const { post, workerRepository } = setup();
      const response = await post("/v1/account-data-exports", { formatVersion });
      expect(response.status).toBe(201);
      const created = accountDataExportJobReadResourceSchema.parse(await response.json());
      await database.query(
        "UPDATE account_data_export_jobs SET state='failed',last_error_code='export-build-failed' WHERE id=$1",
        [created.id],
      );
      const path = `/v1/account-data-exports/${created.id}/retry`;
      expect((await post(path, { expectedRevision: 1 }, "wrong-format", owner, 1)).status).toBe(
        409,
      );
      expect(
        (await post(path, { expectedRevision: 1, formatVersion }, "foreign", other, 1)).status,
      ).toBe(404);
      const retried = await post(path, { expectedRevision: 1, formatVersion }, "retry", owner, 1);
      expect(await retried.json()).toMatchObject({
        id: created.id,
        formatVersion,
        state: "pending",
        revision: 2,
      });
      expect(
        await (await post(path, { expectedRevision: 1, formatVersion }, "retry", owner, 1)).json(),
      ).toMatchObject({ revision: 2 });
      expect(await workerRepository.claimExport()).toMatchObject({
        exportId: created.id,
        formatVersion,
      });
    },
  );
});
