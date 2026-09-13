import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  accountDataExportRecordV3Schema,
  accountDataExportRecordV2Schema,
  projectAccountDataExportRecordForV2,
  formatPracticeTeachingFeedback,
} from "@huayi/cloud-contracts";
import {
  createPracticeTeachingFixture,
  practiceOwner,
  practiceOther,
  practiceVersions,
  practiceItemId,
} from "./test-support/practice-teaching-fixture.js";
import { createPostgresAccountDataExportSource } from "./postgres-account-data-export-source.js";
import { createPostgresLearningItemDelete } from "./postgres-learning-item-delete.js";
import { createAccountDataRightsWorker } from "./account-data-rights-worker.js";
import { createPostgresAccountDataRightsWorker } from "./postgres-account-data-rights-worker.js";
import { MutableClock, DeterministicSecrets } from "./test-support/security-fakes.js";

let f: Awaited<ReturnType<typeof createPracticeTeachingFixture>>;
beforeEach(async () => {
  f = await createPracticeTeachingFixture();
});
afterEach(async () => f.db.close());
// PGlite serializes fixture transactions; independent PostgreSQL tests cover actual MVCC.
function source() {
  return createPostgresAccountDataExportSource({ ...f.database, snapshot: f.database.transaction });
}
function rate(session: { id: string; revision: number }) {
  return f.repository.rate({
    ownerUserId: practiceOwner,
    sessionId: session.id,
    idempotencyKey: "rating",
    requestHash: "b".repeat(64),
    now: new Date().toISOString(),
    input: {
      expectedRevision: session.revision,
      ratings: [{ itemId: practiceItemId, rating: "mastered" }],
    },
  });
}
it("reads all five ordered answers and hint facts with the original session, without changing them", async () => {
  let session = await f.begin();
  for (let ordinal = 0; ordinal < 5; ordinal++) {
    if (ordinal % 2 === 0)
      session = (
        await f.teaching.act(
          practiceOwner,
          session.id,
          {
            action: "reveal-hint",
            expectedRevision: session.revision,
            expectedControlRevision: session.workspace?.controlRevision ?? 0,
            ordinal,
          },
          `hint-${ordinal}`,
        )
      ).session;
    session = await f.complete(session);
    if (ordinal === 0) session = await rate(session);
    if (ordinal < 4)
      session = (
        await f.teaching.act(
          practiceOwner,
          session.id,
          { action: "rewrite", ...practiceVersions(session) },
          `rewrite-${ordinal}`,
        )
      ).session;
  }
  const first = session.attempts?.[0],
    last = session.attempts?.at(-1);
  if (!first || !last) throw new Error("Missing fixture answers.");
  const revised = {
    assessment: "needs-revision",
    answerExcerpt: "I need",
    mainPointZh: "把需要的时间说得更明确。",
    exampleSentence: "I need at least two full days.",
    usageNoteZh: "补充具体的时间范围。",
  } as const;
  const ready = {
    assessment: "ready",
    mainPointZh: "这次表达已经清楚。",
    exampleSentence: "I need at least two days.",
    usageNoteZh: "可以用来说明时间下限。",
  } as const;
  for (const [attempt, feedback] of [
    [first, revised],
    [last, ready],
  ] as const)
    await f.db.query(
      "UPDATE practice_attempts SET feedback_structured=$2::jsonb,feedback=$3 WHERE id=$1",
      [attempt.id, JSON.stringify(feedback), formatPracticeTeachingFeedback(feedback)],
    );
  await f.db.query("UPDATE practice_sessions SET final_feedback=$2 WHERE id=$1", [
    session.id,
    formatPracticeTeachingFeedback(ready),
  ]);
  await f.db.query(
    "UPDATE practice_attempts SET submitted_at='2026-09-13T00:00:00Z' WHERE session_id=$1",
    [session.id],
  );
  const before = await f.teaching.get(practiceOwner, session.id);
  const records = await source().records(practiceOwner, new Date().toISOString(), 3);
  const record = records.find((value) => value.recordType === "practice-session");
  expect(record).toEqual({
    recordType: "practice-session",
    session: before.session,
    teaching: before.teaching,
  });
  expect(accountDataExportRecordV3Schema.parse(record)).toEqual(record);
  const exportId = crypto.randomUUID();
  await f.db.query(
    "INSERT INTO account_data_export_jobs(id,owner_user_id,state,format_version) VALUES($1,$2,'pending',3)",
    [exportId, practiceOwner],
  );
  const upload = vi.fn<(key: string, bytes: Uint8Array) => Promise<void>>(async () => undefined);
  const worker = createAccountDataRightsWorker({
    now: () => new Date(),
    exportSource: source(),
    repository: createPostgresAccountDataRightsWorker(f.database, {
      clock: new MutableClock(new Date().toISOString()),
      pepper: "offline-export-pepper",
      secrets: new DeterministicSecrets(),
    }),
    authority: { upload, deleteObjects: vi.fn(), deleteAuthUser: vi.fn() },
  });
  expect(await worker.runOne()).toEqual({ deletion: "idle", export: "processed" });
  const bytes = upload.mock.calls[0]?.[1];
  if (!bytes) throw new Error("Missing format 3 file.");
  const decoded = new TextDecoder()
    .decode(bytes)
    .trimEnd()
    .split("\n")
    .map((line) => accountDataExportRecordV3Schema.parse(JSON.parse(line) as unknown));
  expect(decoded[0]).toMatchObject({ recordType: "manifest", schemaVersion: 3 });
  expect(decoded.find((value) => value.recordType === "practice-session")).toEqual(record);
  expect(before.teaching?.attempts.map((value) => value.ordinal)).toEqual([0, 1, 2, 3, 4]);
  expect(await f.teaching.get(practiceOwner, session.id)).toEqual(before);
  const old = (await source().records(practiceOwner, new Date().toISOString(), 2)).find(
    (value) => value.recordType === "practice-session",
  );
  expect(old).toEqual(
    projectAccountDataExportRecordForV2(accountDataExportRecordV3Schema.parse(record)),
  );
  expect(accountDataExportRecordV2Schema.parse(old)).toEqual(old);
  expect(
    (await source().records(practiceOther, new Date().toISOString(), 3)).some(
      (value) => value.recordType === "practice-session",
    ),
  ).toBe(false);
});

it("requires a snapshot before format 3 reads and never silently falls back to a normal transaction", async () => {
  const transaction = vi.fn();
  const without = createPostgresAccountDataExportSource({
    ...f.database,
    transaction(owner, operation) {
      transaction();
      return f.database.transaction(owner, operation);
    },
  });
  await expect(without.records(practiceOwner, new Date().toISOString(), 3)).rejects.toThrow(
    "snapshot",
  );
  expect(transaction).not.toHaveBeenCalled();
});

it("exports erased target metadata after item deletion and explicit null for legacy sessions", async () => {
  const session = await rate(await f.complete(await f.begin()));
  await f.db.query("UPDATE learning_items SET archived_at=now() WHERE id=$1", [practiceItemId]);
  await createPostgresLearningItemDelete(f.database)({
    ownerUserId: practiceOwner,
    id: practiceItemId,
    expectedRevision: 1,
    idempotencyKey: "erase",
    requestHash: "a".repeat(64),
    now: new Date().toISOString(),
  });
  const record = (await source().records(practiceOwner, new Date().toISOString(), 3)).find(
    (value) => value.recordType === "practice-session",
  );
  expect(record).toMatchObject({ teaching: { target: { state: "deleted" } } });
  expect(JSON.stringify(record)).not.toContain('"content"');
  await f.db.query("UPDATE practice_sessions SET teaching_state=NULL WHERE id=$1", [session.id]);
  expect(
    (await source().records(practiceOwner, new Date().toISOString(), 3)).find(
      (value) => value.recordType === "practice-session",
    ),
  ).toMatchObject({ teaching: null, session: { id: session.id } });
});
