import { z } from "zod/v3";
import {
  formatPracticeTeachingFeedback,
  practiceTeachingFeedbackSchema,
} from "@huayi/cloud-contracts";

const textSchema = z.string().trim().min(1).max(4_000);
export const practiceGenerationOutputSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("sentence-prompt"), prompt: textSchema }),
    z.strictObject({
      feedback: textSchema,
      kind: z.literal("sentence-feedback"),
      teachingFeedback: practiceTeachingFeedbackSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal("dialogue-start"),
      opener: textSchema,
      plan: z.strictObject({
        endConditionZh: textSchema,
        roleZh: textSchema,
        taskZh: textSchema,
      }),
      prompt: textSchema,
    }),
    z.strictObject({ assistantTurn: textSchema, kind: z.literal("dialogue-assistant") }),
    z.strictObject({
      itemFeedbacks: z
        .array(
          z.strictObject({ feedback: textSchema, itemAlias: z.string().regex(/^item-[1-3]$/u) }),
        )
        .min(1)
        .max(3),
      kind: z.literal("dialogue-final-feedback"),
      summary: textSchema,
    }),
  ])
  .superRefine((output, context) => {
    const teaching =
      output.kind === "sentence-feedback"
        ? practiceTeachingFeedbackSchema.safeParse(output.teachingFeedback)
        : null;
    if (
      output.kind === "sentence-feedback" &&
      teaching?.success &&
      output.feedback !== formatPracticeTeachingFeedback(teaching.data)
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Feedback projection differs." });
    }
  });
export type PracticeGenerationOutput = z.infer<typeof practiceGenerationOutputSchema>;
export type PracticeGenerationKind = PracticeGenerationOutput["kind"];

export class PracticeOutputValidationError extends Error {}

/** Validate the saved contract and the exact answer before accepting any paid output. */
export function parsePracticeGenerationOutput(
  value: unknown,
  command: { kind: PracticeGenerationKind; input: Record<string, unknown> },
) {
  const output = practiceGenerationOutputSchema.parse(value);
  if (output.kind !== command.kind) throw new PracticeOutputValidationError();
  if (output.kind === "sentence-feedback") {
    const teaching = command.input["teachingContract"] === "practice-teaching-v1";
    if (teaching !== (output.teachingFeedback !== undefined))
      throw new PracticeOutputValidationError();
    const feedback = output.teachingFeedback;
    if (
      feedback !== undefined &&
      (!/\p{Script=Han}/u.test(feedback.mainPointZh) ||
        !/\p{Script=Han}/u.test(feedback.usageNoteZh) ||
        !/\p{Script=Latin}/u.test(feedback.exampleSentence) ||
        /\p{Script=Han}/u.test(feedback.exampleSentence))
    )
      throw new PracticeOutputValidationError();
    if (
      feedback?.assessment === "needs-revision" &&
      (typeof command.input["answer"] !== "string" ||
        !command.input["answer"].includes(feedback.answerExcerpt))
    ) {
      throw new PracticeOutputValidationError();
    }
  }
  if (
    output.kind === "sentence-prompt" &&
    command.input["hintPolicy"] === "on-demand" &&
    /\p{Script=Latin}/u.test(output.prompt)
  )
    throw new PracticeOutputValidationError();
  return output;
}
