import { createHash, randomUUID } from "node:crypto";
import {
  learningTaskCommandSchema,
  learningTaskEventSchema,
  learningTaskPayloadSchema,
  learningTaskSnapshotSchema,
  type LearningTaskSnapshot,
} from "@huayi/cloud-contracts";
import type { AnalysisDatabase } from "./analysis-database.js";
import type { LearningTaskStore } from "./learning-task-store.js";
import { CloudFault } from "./cloud-fault.js";

interface Row {
  id: string;
  kind: string;
  subject_id: string | null;
  state: string;
  cursor: number;
  created_at: Date;
  updated_at: Date;
  output: unknown;
  timings: unknown;
  error_code: string | null;
  owner_user_id: string;
  command: unknown;
  lease_token: string;
}
function snapshot(row: Row): LearningTaskSnapshot {
  return learningTaskSnapshotSchema.parse({
    version: 2,
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    state: row.state,
    cursor: row.cursor,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    output: row.output,
    timings: row.timings,
    error: row.error_code ? { code: row.error_code, diagnosticId: row.id } : null,
  });
}
export function createPostgresLearningTasks(database: AnalysisDatabase): LearningTaskStore {
  return {
    async submit(owner, key, command) {
      const parsed = learningTaskCommandSchema.parse(command);
      try {
        const rows = await database.trusted((query) =>
          query.rows<Row>(
            "SELECT * FROM huayi_private.enqueue_learning_task($1,$2,$3,$4,$5::jsonb)",
            [
              owner,
              randomUUID(),
              key,
              createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
              JSON.stringify(parsed),
            ],
          ),
        );
        if (!rows[0]) throw new Error("Task creation returned no row");
        return snapshot(rows[0]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("task expired"))
          throw new CloudFault("not_found", "This task has expired. Start a new query explicitly.");
        if (message.includes("idempotency conflict"))
          throw new CloudFault(
            "idempotency_conflict",
            "The task key was reused for different input.",
          );
        if (message.includes("generation busy"))
          throw new CloudFault("generation_busy", "The collection queue is full.");
        if (message.includes("active account required"))
          throw new CloudFault("forbidden", "An active account is required.");
        throw error;
      }
    },
    async get(owner, id) {
      const rows = await database.transaction(owner, ({ tenant }) =>
        tenant.rows<Row>("SELECT * FROM learning_tasks WHERE id=$1", [id]),
      );
      return rows[0] ? snapshot(rows[0]) : null;
    },
    async list(owner) {
      return database.transaction(owner, async ({ tenant }) =>
        (
          await tenant.rows<Row>(
            "SELECT * FROM learning_tasks ORDER BY created_at DESC,id DESC LIMIT 100",
          )
        ).map(snapshot),
      );
    },
    async events(owner, id, cursor) {
      return database.transaction(owner, async ({ tenant }) =>
        (
          await tenant.rows<{ cursor: number; payload: unknown }>(
            "SELECT cursor,payload FROM learning_task_events WHERE task_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 128",
            [id, cursor],
          )
        ).map((row) =>
          learningTaskEventSchema.parse({
            version: 2,
            taskId: id,
            cursor: row.cursor,
            payload: row.payload,
          }),
        ),
      );
    },
    async cancel(owner, id) {
      const rows = await database.trusted((query) =>
        query.rows<Row>("SELECT * FROM huayi_private.cancel_learning_task($1,$2)", [owner, id]),
      );
      return rows[0]?.id ? snapshot(rows[0]) : null;
    },
    async claim() {
      const rows = await database.trusted((query) =>
        query.rows<Row>("SELECT * FROM huayi_private.claim_learning_task($1,$2)", [
          randomUUID(),
          new Date(),
        ]),
      );
      const row = rows[0];
      return row
        ? {
            id: row.id,
            ownerUserId: row.owner_user_id,
            createdAt: row.created_at.toISOString(),
            leaseToken: row.lease_token,
            command: learningTaskCommandSchema.parse(row.command),
          }
        : null;
    },
    async touch(job, dispatch = false) {
      const rows = await database.trusted((query) =>
        query.rows<{ state: "running" | "cancelling" | "lost" }>(
          "SELECT huayi_private.touch_learning_task($1,$2,$3,$4) AS state",
          [job.id, job.leaseToken, new Date(), dispatch],
        ),
      );
      return rows[0]?.state ?? "lost";
    },
    async append(job, payloads, timings) {
      await database.trusted((query) =>
        query.rows("SELECT huayi_private.append_learning_task_events($1,$2,$3::jsonb,$4::jsonb)", [
          job.id,
          job.leaseToken,
          JSON.stringify(payloads.map((payload) => learningTaskPayloadSchema.parse(payload))),
          JSON.stringify(timings),
        ]),
      );
    },
    async finish(job, outcome, output, error) {
      await database.trusted((query) =>
        query.rows("SELECT huayi_private.finish_learning_task($1,$2,$3,$4::jsonb,$5)", [
          job.id,
          job.leaseToken,
          outcome,
          output ? JSON.stringify(learningTaskPayloadSchema.parse(output)) : null,
          error?.code ?? null,
        ]),
      );
    },
  };
}
