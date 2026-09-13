import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPracticeReference } from "./practice-reference.js";
import {
  createPracticeTeachingFixture,
  practiceOwner,
  practiceOther,
  type practiceVersions,
} from "./test-support/practice-teaching-fixture.js";
import type { PracticeGenerationCommand } from "./paid-practice-generator.js";
import { createPaidPracticeGenerator } from "./paid-practice-generator.js";
import { createPostgresPracticeGenerationRepository } from "./postgres-practice-generation.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { accountDataExportRecordV4Schema } from "@huayi/cloud-contracts";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { MutableClock, DeterministicSecrets } from "./test-support/security-fakes.js";

let f: Awaited<ReturnType<typeof createPracticeTeachingFixture>>;
beforeEach(async () => {
  f = await createPracticeTeachingFixture();
});
afterEach(async () => {
  await f.db.close();
});
const result = {
  sentence: "I need at least two days to finish the report.",
  translationZh: "我至少需要两天来完成报告。",
  usageNoteZh: "at least 说明最低时间要求。",
};
async function setup() {
  const priceId = randomUUID();
  await f.db.query(
    "INSERT INTO runtime_controls(name,enabled) VALUES('model_kill_switch',false) ON CONFLICT(name) DO UPDATE SET enabled=false",
  );
  await f.db.query(
    "INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from) VALUES($1,'deepseek','offline-reference',100,100,100,now())",
    [priceId],
  );
  await f.db.query(
    "INSERT INTO quota_grants(id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source) VALUES($1,$2,$2,date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',1000,'default')",
    [randomUUID(), practiceOwner],
  );
  const now = () => new Date();
  const generator = createPaidPracticeGenerator({
    repository: createPostgresPracticeGenerationRepository({
      database: f.database,
      ledgerId: randomUUID,
      now,
      priceVersionId: priceId,
      reservedMicroUsd: 100,
      quota: createPostgresAnalysisQuota({
        database: f.database,
        id: randomUUID,
        now,
        expiresAt: () => new Date(Date.now() + 180000),
        priceVersionId: priceId,
      }),
    }),
    provider: {
      generate: async (command) => {
        await command.beforeDispatch?.();
        return {
          output: { kind: "sentence-reference", ...result },
          billedCalls: [
            { costMicroUsd: 10, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 } },
          ],
        };
      },
    },
  });
  const generate = vi.fn((command: PracticeGenerationCommand) => generator.generate(command));
  return { generate, reference: createPracticeReference(f.database, { generate }) };
}
const input = (session: Parameters<typeof practiceVersions>[0]) => ({
  expectedRevision: session.revision,
  expectedControlRevision: session.workspace?.controlRevision ?? 0,
  ordinal: 0,
});

it("generates from the saved task without a draft, then reveals and reuses one reference", async () => {
  let session = await f.begin();
  session = await f.workspace.draft(practiceOwner, session.id, {
    draft: "Keep my draft",
    expectedDraftRevision: 0,
  });
  const { reference, generate } = await setup();
  expect((await reference.get(practiceOwner, session.id)).reference).toBeNull();
  expect(generate).not.toHaveBeenCalled();
  await reference.generate(practiceOwner, session.id, input(session), randomUUID());
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      input: {
        mode: "guided",
        prompt: session.prompt,
        itemContent: expect.objectContaining({ text: "at least" }),
      },
    }),
  );
  expect(JSON.stringify(generate.mock.calls)).not.toContain("Keep my draft");
  expect((await reference.get(practiceOwner, session.id)).reference).toBeNull();
  const shown = await reference.reveal(practiceOwner, session.id, input(session), randomUUID());
  expect(shown.reference).toEqual(result);
  const after = await f.workspace.get(practiceOwner, session.id);
  expect(after.workspace?.draft).toBe("Keep my draft");
  expect(after.attempts ?? []).toHaveLength(0);
  expect(
    (await f.teaching.get(practiceOwner, session.id)).teaching?.round.hintViewedAt,
  ).not.toBeNull();
  await reference.generate(practiceOwner, session.id, input(after), randomUUID());
  expect(generate).toHaveBeenCalledTimes(1);
});

it("keeps reference reads and generation scoped to the session owner", async () => {
  const session = await f.begin();
  const { reference, generate } = await setup();
  await expect(reference.get(practiceOther, session.id)).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    reference.generate(practiceOther, session.id, input(session), randomUUID()),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(generate).not.toHaveBeenCalled();
});

it("includes saved references and view facts in format 4 while keeping format 3 exact", async () => {
  const session = await f.begin();
  const { reference } = await setup();
  await reference.generate(practiceOwner, session.id, input(session), randomUUID());
  const shown = await reference.reveal(practiceOwner, session.id, input(session), randomUUID());
  const source = createPostgresAccountDataExportSource({
    ...f.database,
    snapshot: f.database.transaction,
  });
  const find = async (version: 3 | 4) =>
    (await source.records(practiceOwner, new Date().toISOString(), version)).find(
      (record) => record.recordType === "practice-session",
    );
  const current = await find(4);
  expect(current).toMatchObject({
    reference: { version: 1, result, views: [{ ordinal: 0, viewedAt: shown.viewedAt }] },
  });
  expect(JSON.stringify(current)).not.toContain("generationId");
  expect(JSON.stringify(current)).not.toContain("identity");
  expect(await find(3)).not.toHaveProperty("reference");
  await f.db.query(
    "INSERT INTO account_data_export_jobs(id,owner_user_id,state,format_version) VALUES($1,$2,'pending',4)",
    [randomUUID(), practiceOwner],
  );
  const upload = vi.fn<(key: string, bytes: Uint8Array) => Promise<void>>(async () => undefined);
  const worker = createAccountDataRightsWorker({
    now: () => new Date(),
    exportSource: source,
    repository: createPostgresAccountDataRightsWorker(f.database, {
      clock: new MutableClock(new Date().toISOString()),
      pepper: "offline-export-pepper",
      secrets: new DeterministicSecrets(),
    }),
    authority: { upload, deleteObjects: vi.fn(), deleteAuthUser: vi.fn() },
  });
  expect(await worker.runOne()).toEqual({ deletion: "idle", export: "processed" });
  const bytes = upload.mock.calls[0]?.[1];
  if (!bytes) throw new Error("Missing reference export.");
  const exported = new TextDecoder()
    .decode(bytes)
    .trimEnd()
    .split("\n")
    .map((line) => accountDataExportRecordV4Schema.parse(JSON.parse(line) as unknown));
  expect(exported[0]).toMatchObject({ recordType: "manifest", schemaVersion: 4 });
  expect(exported.find((record) => record.recordType === "practice-session")).toEqual(current);
});
