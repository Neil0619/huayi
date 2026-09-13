import { z } from "zod/v3";
import { practiceSessionResponseSchema, type PracticeSession } from "@huayi/cloud-contracts";
import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";

export const feedbackReceiptSchema = z
  .strictObject({
    type: z.literal("practice-feedback-receipt"),
    version: z.literal(1),
    sessionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    generationId: z.string().uuid(),
    state: z.enum(["pending", "applied"]),
    session: practiceSessionResponseSchema,
  })
  .refine(
    (value) =>
      value.session.id === value.sessionId &&
      value.session.attempts?.some((attempt) => attempt.id === value.attemptId),
    "Feedback receipt identity differs.",
  );
export type FeedbackReceipt = z.infer<typeof feedbackReceiptSchema>;
export type FeedbackOperation = "practice.attempt" | "practice.feedback-retry";
export interface FeedbackReceiptCommand {
  ownerUserId: string;
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  now: string;
}

export function readFeedbackReceipt(
  value: unknown,
  command: FeedbackReceiptCommand & { attemptId?: string },
) {
  const receipt = feedbackReceiptSchema.safeParse(value);
  const session = receipt.success
    ? receipt.data.session
    : practiceSessionResponseSchema.parse(value);
  if (
    session.id !== command.sessionId ||
    (command.attemptId !== undefined &&
      (receipt.success
        ? receipt.data.attemptId !== command.attemptId
        : !session.attempts?.some((answer) => answer.id === command.attemptId)))
  ) {
    throw new CloudFault("idempotency_conflict", "The feedback key belongs to another answer.");
  }
  return receipt.success ? receipt.data : session;
}

export async function saveFeedbackReceipt(
  query: AnalysisQuery,
  command: FeedbackReceiptCommand,
  operation: FeedbackOperation,
  identity: { attemptId: string; generationId: string },
  session: PracticeSession,
) {
  const receipt = feedbackReceiptSchema.parse({
    type: "practice-feedback-receipt",
    version: 1,
    sessionId: session.id,
    ...identity,
    state: "pending",
    session,
  });
  await query.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
    VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      command.ownerUserId,
      operation,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(receipt),
      new Date(Date.parse(command.now) + 7 * 86_400_000),
    ],
  );
  return receipt;
}

export async function applyFeedbackReceipts(
  query: AnalysisQuery,
  command: FeedbackReceiptCommand & {
    attemptId: string;
    generationId: string;
    operation: FeedbackOperation;
  },
  session: PracticeSession,
) {
  // All keys that joined this exact generation receive the same durable completion.
  // No request hash equality is needed across an original submit and a retry key.
  await query.rows(
    `UPDATE idempotency_records SET response=jsonb_set(jsonb_set(response,'{state}','"applied"'),'{session}',$5::jsonb)
    WHERE owner_user_id=$1 AND operation IN ('practice.attempt','practice.feedback-retry')
      AND response->>'type'='practice-feedback-receipt' AND response->>'sessionId'=$2
      AND response->>'attemptId'=$3 AND response->>'generationId'=$4`,
    [
      command.ownerUserId,
      command.sessionId,
      command.attemptId,
      command.generationId,
      JSON.stringify(session),
    ],
  );
  // Upgrade-era string/session receipts keep their published internal representation.
  await query.rows(
    `UPDATE idempotency_records SET response=$6::jsonb
    WHERE owner_user_id=$1 AND operation=$2 AND key=$3 AND request_hash=$4
      AND response->>'id'=$5 AND response->>'type'<>'practice-feedback-receipt'`,
    [
      command.ownerUserId,
      command.operation,
      command.idempotencyKey,
      command.requestHash,
      command.sessionId,
      JSON.stringify(session),
    ],
  );
}
