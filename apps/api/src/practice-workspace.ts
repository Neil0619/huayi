import { createHash, randomUUID } from "node:crypto";
import {
  practiceSessionResponseSchema,
  practiceWorkspaceStartSchema,
  practiceWorkspaceControlSchema,
  practiceWorkspaceDraftSchema,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { savePracticeWrite } from "./postgres-practice-idempotency.js";
import {
  loadPracticeSession,
  requireActiveProfile,
  requireActivePracticeItem,
} from "./postgres-practice-view.js";

const stateOf = (session: PracticeSession) =>
  session.workspace ?? {
    phase: "active" as const,
    mode: "guided" as const,
    draft: "",
    draftRevision: 0,
  };
async function ownerLock(query: AnalysisQuery, owner: string) {
  await query.rows("SELECT user_id FROM user_profiles WHERE user_id=$1 FOR UPDATE", [owner]);
  await requireActiveProfile(query, owner);
}
async function workspaceWrite(
  query: AnalysisQuery,
  operation: string,
  key: string,
  digest: string,
) {
  const rows = await query.rows<{ request_hash: string; response: unknown }>(
    "SELECT request_hash,response FROM idempotency_records WHERE operation=$1 AND key=$2",
    [operation, key],
  );
  const existing = rows[0];
  if (existing && existing.request_hash !== digest)
    throw new CloudFault(
      "idempotency_conflict",
      "The practice key was reused for different input.",
    );
  return existing?.response;
}
async function available(query: AnalysisQuery, except?: string) {
  const rows = await query.rows<{ id: string }>(
    `SELECT id FROM practice_sessions WHERE workspace_state->>'phase'='active' AND id IS DISTINCT FROM $1::uuid AND
    (status IN ('active','awaiting-feedback') OR (status='completed' AND EXISTS (SELECT 1 FROM practice_session_items WHERE session_id=practice_sessions.id AND rating IS NULL))) LIMIT 1`,
    [except ?? null],
  );
  if (rows[0])
    throw new CloudFault("generation_busy", "Pause the current practice before switching items.");
}
async function freePrompt(query: AnalysisQuery, itemId: string) {
  const item = await requireActivePracticeItem(query, itemId);
  const content = item.item.content;
  return content.type === "expression"
    ? `请在一个新场景中使用表达 ${content.text}（${content.meaningZh}），写一个完整的英文句子。`
    : `请套用句型 ${content.template}（${content.functionZh}），写一个符合你生活情境的英文句子。`;
}

export function createPracticeWorkspace(database: AnalysisDatabase) {
  const common = (ownerUserId: string, idempotencyKey: string, input: unknown) => ({
    ownerUserId,
    idempotencyKey,
    now: new Date().toISOString(),
    requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  });
  return {
    async start(owner: string, input: unknown, key: string) {
      const request = practiceWorkspaceStartSchema.parse(input);
      const command = common(owner, key, request);
      return database.transaction(owner, async ({ tenant }) => {
        await ownerLock(tenant, owner);
        const replay = await workspaceWrite(
          tenant,
          "practice.workspace-start",
          key,
          command.requestHash,
        );
        if (replay != null)
          return loadPracticeSession(tenant, practiceSessionResponseSchema.parse(replay).id);
        await available(tenant);
        const item = await requireActivePracticeItem(tenant, request.itemId, { lock: true });
        const id = randomUUID();
        const prompt = request.mode === "free" ? await freePrompt(tenant, request.itemId) : null;
        await tenant.rows(
          `INSERT INTO practice_sessions(id,owner_user_id,type,status,prompt,pending_generation,workspace_state)
          VALUES($1,$2,'sentence-creation',$3,$4,$5,$6::jsonb)`,
          [
            id,
            owner,
            prompt ? "active" : "awaiting-feedback",
            prompt,
            prompt ? null : "sentence-prompt",
            JSON.stringify({ phase: "active", mode: request.mode, draft: "", draftRevision: 0 }),
          ],
        );
        await tenant.rows(
          `INSERT INTO practice_session_items(session_id,learning_item_id,owner_user_id,position,schedule_before) VALUES($1,$2,$3,0,$4::jsonb)`,
          [id, request.itemId, owner, JSON.stringify(item.schedule)],
        );
        const session = await loadPracticeSession(tenant, id);
        await savePracticeWrite(tenant, command, "practice.workspace-start", session);
        return session;
      });
    },
    async list(owner: string) {
      return database.transaction(owner, async ({ tenant }) => {
        await requireActiveProfile(tenant, owner);
        const rows = await tenant.rows<{ id: string }>(
          "SELECT id FROM practice_sessions WHERE workspace_state->>'phase' IN ('active','paused') ORDER BY updated_at DESC LIMIT 20",
        );
        return Promise.all(rows.map((row) => loadPracticeSession(tenant, row.id)));
      });
    },
    async get(owner: string, id: string) {
      return database.transaction(owner, ({ tenant }) => loadPracticeSession(tenant, id));
    },
    async draft(owner: string, id: string, input: unknown) {
      const request = practiceWorkspaceDraftSchema.parse(input);
      return database.transaction(owner, async ({ tenant }) => {
        await requireActiveProfile(tenant, owner);
        const updated = await tenant.rows<{ id: string }>(
          `UPDATE practice_sessions SET workspace_state=workspace_state||jsonb_build_object('draft',$2::text,'draftRevision',$3::integer+1),updated_at=now()
          WHERE id=$1 AND workspace_state->>'phase' IN ('active','paused') AND (workspace_state->>'draftRevision')::integer=$3 RETURNING id`,
          [id, request.draft, request.expectedDraftRevision],
        );
        if (!updated[0]) throw new CloudFault("revision_conflict", "Practice draft changed.");
        return loadPracticeSession(tenant, id);
      });
    },
    async control(owner: string, id: string, input: unknown, key: string) {
      const request = practiceWorkspaceControlSchema.parse(input);
      const command = common(owner, key, { id, ...request });
      return database.transaction(owner, async ({ tenant, trusted }) => {
        await ownerLock(tenant, owner);
        const replay = await workspaceWrite(
          tenant,
          "practice.workspace-control",
          key,
          command.requestHash,
        );
        if (replay != null) return loadPracticeSession(tenant, id);
        await tenant.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR UPDATE", [id]);
        const session = await loadPracticeSession(tenant, id);
        const workspace = stateOf(session);
        if (
          session.revision !== request.expectedRevision ||
          (request.expectedControlRevision !== undefined &&
            request.expectedControlRevision !== (workspace.controlRevision ?? 0)) ||
          ["ended", "skipped"].includes(workspace.phase)
        )
          throw new CloudFault("revision_conflict", "Practice state changed.");
        if (request.action === "resume") await available(tenant, id);
        if (request.draft !== undefined) {
          workspace.draft = request.draft;
          workspace.draftRevision += 1;
        }
        if (request.action === "free") {
          if (session.type !== "sentence-creation" || (session.attempts?.length ?? 0) > 0)
            throw new CloudFault(
              "revision_conflict",
              "Only an unanswered sentence can switch mode.",
            );
          workspace.mode = "free";
          const prompt = await freePrompt(tenant, session.items[0]?.itemId ?? "");
          await tenant.rows(
            "UPDATE practice_sessions SET prompt=$2,status='active',pending_generation=NULL WHERE id=$1",
            [id, prompt],
          );
        } else
          workspace.phase =
            request.action === "pause"
              ? "paused"
              : request.action === "resume"
                ? "active"
                : request.action === "skip"
                  ? "skipped"
                  : "ended";
        workspace.controlRevision = (workspace.controlRevision ?? 0) + 1;
        // Navigation does not invalidate an answer already waiting in the durable queue.
        // Mode changes and ending do invalidate old writes and cancel their queued jobs.
        const revisionStep = ["pause", "resume"].includes(request.action) ? 0 : 1;
        await tenant.rows(
          "UPDATE practice_sessions SET workspace_state=$2::jsonb,revision=revision+$3,updated_at=now() WHERE id=$1",
          [id, JSON.stringify(workspace), revisionStep],
        );
        // Cancel matching queue jobs, preserving their leases and all provider billing receipts.
        if (["free", "end", "skip"].includes(request.action)) {
          const jobs = await tenant.rows<{ id: string }>(
            `SELECT id FROM public.learning_tasks WHERE owner_user_id=$1 AND state IN ('queued','running') AND
            (subject_id=$2::uuid OR (kind='sentence-start' AND subject_id=$3::uuid AND created_at>=$4::timestamptz))`,
            [owner, id, session.items[0]?.itemId ?? null, session.createdAt],
          );
          for (const job of jobs)
            await trusted.rows("SELECT huayi_private.cancel_learning_task($1,$2)", [owner, job.id]);
        }
        const result = await loadPracticeSession(tenant, id);
        await savePracticeWrite(tenant, command, "practice.workspace-control", result);
        return result;
      });
    },
  };
}
export type PracticeWorkspace = ReturnType<typeof createPracticeWorkspace>;
