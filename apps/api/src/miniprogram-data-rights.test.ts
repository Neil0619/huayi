import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createPostgresMiniProgramIdentity } from "./postgres-miniprogram-identity.js";
import { createAccountDataRightsModule } from "./account-data-rights-module.js";
import { createPostgresAccountDataRights } from "./postgres-account-data-rights.js";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { systemClock, systemSecrets } from "./security.js";

let database: PGlite;
beforeAll(async () => {
  database = new PGlite();
  for (const name of ["0001-cloud-v1-foundation", "0029-wechat-miniprogram"])
    await database.exec(
      await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"),
    );
});
afterAll(async () => database?.close());
it("independently opens, exports, recently authenticates and deletes a pure WeChat account through runtime roles", async () => {
  const adapter = createPgliteAnalysisDatabase(database);
  const pepper = "test-pepper-at-least-thirty-two-characters";
  const identity = createPostgresMiniProgramIdentity({ database: adapter, pepper });
  const proof = { appId: "wx0123456789abcdef", openId: "private-subject" };
  const initial = await identity.begin(proof);
  if (initial.state !== "onboarding") throw new Error("Expected initial choice.");
  const session = await identity.onboard(initial.ticket, "independent");
  const auth = await identity.authenticate(session.token);
  const rights = createAccountDataRightsModule({
    now: systemClock.now,
    repository: createPostgresAccountDataRights(adapter, { id: () => crypto.randomUUID(), pepper }),
    signedUrls: { create: async () => ({ url: "https://storage.example.test/signed" }) },
  });
  const exported = await rights.requestExport(auth.userId, crypto.randomUUID(), {});
  const deleteAuthUser = vi.fn(async () => undefined);
  await createPostgresAccountDataExportSource(adapter).records(
    auth.userId,
    new Date().toISOString(),
  );
  const upload = vi.fn<(key: string, body: Uint8Array) => Promise<void>>(async () => undefined);
  const worker = createAccountDataRightsWorker({
    authority: { deleteAuthUser, upload, deleteObjects: async () => undefined },
    exportSource: createPostgresAccountDataExportSource(adapter),
    now: systemClock.now,
    repository: createPostgresAccountDataRightsWorker(adapter, {
      clock: systemClock,
      secrets: systemSecrets,
      pepper,
    }),
  });
  expect(await worker.runOne()).toEqual({ deletion: "idle", export: "processed" });
  expect(upload).toHaveBeenCalledOnce();
  expect(new TextDecoder().decode(upload.mock.calls[0]?.[1])).toContain(
    '"recordType":"account-preferences"',
  );
  await expect(
    rights.createDownload(auth.userId, exported.id, auth.reauthenticatedAt),
  ).rejects.toMatchObject({ code: "forbidden" });
  await identity.reauthenticate(session.token, proof);
  const fresh = await identity.authenticate(session.token);
  expect(
    await rights.createDownload(auth.userId, exported.id, fresh.reauthenticatedAt),
  ).toHaveProperty("url");
  await rights.requestDeletion(
    auth.userId,
    crypto.randomUUID(),
    fresh.sessionHash,
    fresh.reauthenticatedAt,
    { confirmation: "delete-account" },
  );
  await expect(identity.authenticate(session.token)).rejects.toMatchObject({
    code: "authentication_required",
  });
  expect(await worker.runOne()).toEqual({ deletion: "processed", export: "idle" });
  expect(deleteAuthUser).not.toHaveBeenCalled();
  expect((await database.query("SELECT * FROM user_profiles")).rows).toEqual([]);
  expect((await database.query("SELECT * FROM wechat_identities")).rows).toEqual([]);
});
