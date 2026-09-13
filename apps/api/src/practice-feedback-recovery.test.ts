import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createFeedbackTaskFixture,
  teachingFeedback,
  type FeedbackCrash,
} from "./test-support/practice-feedback-task-fixture.js";
import { practiceOwner } from "./test-support/practice-teaching-fixture.js";

describe("durable feedback result recovery", () => {
  it.each(
    (["ready-return", "apply-before", "apply-return"] as FeedbackCrash[]).flatMap((crash) =>
      [false, true].map((retry) => ({ crash, retry })),
    ),
  )(
    "recovers $crash for retry=$retry with the same task, answer and charges",
    async ({ crash, retry }) => {
      const f = await createFeedbackTaskFixture(crash, retry);
      try {
        const session = await f.begin();
        let task = await f.tasks.submit(practiceOwner, randomUUID(), {
          version: 2,
          kind: "sentence-submit",
          sessionId: session.id,
          input: { answer: "I need at least two days.", expectedRevision: session.revision },
        });
        if (retry) {
          expect(await f.worker.runOne()).toMatchObject({ id: task.id, state: "failed" });
          const pending = await f.workspace.get(practiceOwner, session.id);
          const answer = pending.attempts?.[0];
          if (!answer) throw new Error("Answer missing");
          task = await f.tasks.submit(practiceOwner, randomUUID(), {
            version: 2,
            kind: "sentence-feedback-retry",
            sessionId: session.id,
            attemptId: answer.id,
            input: { expectedRevision: pending.revision },
          });
        }
        expect(await f.worker.runOne()).toMatchObject({ id: task.id, state: "unknown" });
        const before = await f.db.query<{
          id: string;
          attempt_id: string;
          reservation_id: string;
          state: string;
        }>(
          "SELECT id::text,attempt_id::text,reservation_id::text,state FROM practice_generation_tasks ORDER BY created_at,id",
        );
        const active = before.rows.find((generation) => generation.state !== "failed");
        expect(active?.state).toBe(crash === "apply-return" ? "applied" : "ready");
        const count = retry ? 2 : 1;
        expect(before.rows).toHaveLength(count);
        expect(f.providerCalls()).toBe(count);
        const ledger = (
          await f.db.query(
            "SELECT id,request_id,call_ordinal,cost_micro_usd FROM usage_ledger ORDER BY id",
          )
        ).rows;
        expect(ledger).toHaveLength(count);
        const reservations = (
          await f.db.query(
            "SELECT id,request_id,status,reserved_micro_usd FROM quota_reservations ORDER BY id",
          )
        ).rows;
        expect(reservations).toHaveLength(count);
        expect(reservations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: active?.reservation_id,
              request_id: active?.id,
              status: "settled",
            }),
          ]),
        );
        await f.recover();
        await f.recover();
        expect(await f.worker.runOne()).toEqual({ claimed: false });
        const restored = await f.tasks.get(practiceOwner, task.id);
        expect(restored).toMatchObject({
          id: task.id,
          state: "completed",
          output: { type: "practice.updated", session: { id: session.id, status: "completed" } },
        });
        const detail = await f.teaching.get(practiceOwner, session.id);
        expect(detail.teaching?.attempts).toHaveLength(1);
        expect(detail.teaching?.attempts[0]).toMatchObject({
          attemptId: active?.attempt_id,
          feedback: teachingFeedback,
        });
        expect(detail.teaching?.attempts[0]?.feedbackCompletedAt).not.toBeNull();
        expect(
          (
            await f.db.query(
              "SELECT id,request_id,call_ordinal,cost_micro_usd FROM usage_ledger ORDER BY id",
            )
          ).rows,
        ).toEqual(ledger);
        expect((await f.db.query("SELECT id FROM practice_generation_tasks")).rows).toHaveLength(
          count,
        );
        expect((await f.db.query("SELECT id FROM practice_attempts")).rows).toHaveLength(1);
        expect(
          (
            await f.db.query(
              "SELECT id,request_id,status,reserved_micro_usd FROM quota_reservations ORDER BY id",
            )
          ).rows,
        ).toEqual(reservations);
        expect(f.providerCalls()).toBe(count);
      } finally {
        await f.db.close();
      }
    },
  );
});
