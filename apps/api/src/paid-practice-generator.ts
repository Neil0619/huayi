import { z } from "zod/v3";

import type { AnalysisBilledCall } from "./analysis-ports.js";
import type { DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";

const textSchema = z.string().trim().min(1).max(4_000);
export const practiceGenerationOutputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("sentence-prompt"), prompt: textSchema }),
  z.strictObject({ feedback: textSchema, kind: z.literal("sentence-feedback") }),
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
      .array(z.strictObject({ feedback: textSchema, itemAlias: z.string().regex(/^item-[1-3]$/u) }))
      .min(1)
      .max(3),
    kind: z.literal("dialogue-final-feedback"),
    summary: textSchema,
  }),
]);
export type PracticeGenerationOutput = z.infer<typeof practiceGenerationOutputSchema>;
export type PracticeGenerationKind = PracticeGenerationOutput["kind"];

export interface PracticeGenerationCommand {
  generationId: string;
  input: Record<string, unknown>;
  kind: PracticeGenerationKind;
  leaseToken: string;
  ownerUserId: string;
}

type AcquiredGeneration =
  | { kind: "acquired"; reservationId: string }
  | { kind: "pending" }
  | { kind: "ready"; output: PracticeGenerationOutput };

export interface PracticeGenerationRepository {
  acquire(command: PracticeGenerationCommand): Promise<AcquiredGeneration>;
  complete(
    command: PracticeGenerationCommand & {
      billedCalls: AnalysisBilledCall[];
      output: PracticeGenerationOutput;
      pricing?: DeepSeekPriceSnapshot;
      reservationId: string;
    },
  ): Promise<PracticeGenerationOutput>;
  fail(
    command: PracticeGenerationCommand & {
      billedCalls?: AnalysisBilledCall[];
      reservationId: string;
      stableErrorCode: "model_output_invalid" | "model_unavailable";
    },
  ): Promise<void>;
  markDispatched(
    command: PracticeGenerationCommand & { reservationId: string },
  ): Promise<boolean | { pricing: DeepSeekPriceSnapshot }>;
}

export interface PracticeProvider {
  generate(command: Pick<PracticeGenerationCommand, "input" | "kind">): Promise<{
    billedCalls: AnalysisBilledCall[];
    output: unknown;
  }>;
}

export class PracticeProviderError extends Error {
  readonly billedCalls?: AnalysisBilledCall[];
  readonly stableErrorCode: "model_output_invalid" | "model_unavailable";

  constructor(
    stableErrorCode: "model_output_invalid" | "model_unavailable",
    billedCalls?: AnalysisBilledCall[],
  ) {
    super("The practice provider request failed.");
    this.name = "PracticeProviderError";
    this.stableErrorCode = stableErrorCode;
    if (billedCalls !== undefined) this.billedCalls = billedCalls;
  }
}

export function createPaidPracticeGenerator(options: {
  provider: PracticeProvider;
  providerForPricing?: (pricing: DeepSeekPriceSnapshot) => PracticeProvider;
  repository: PracticeGenerationRepository;
}) {
  return {
    async generate(command: PracticeGenerationCommand): Promise<PracticeGenerationOutput | null> {
      const acquired = await options.repository.acquire(command);
      if (acquired.kind === "pending") return null;
      if (acquired.kind === "ready") return practiceGenerationOutputSchema.parse(acquired.output);
      const mayDispatch = await options.repository.markDispatched({
        ...command,
        reservationId: acquired.reservationId,
      });
      if (!mayDispatch) return null;
      const dispatchPricing = mayDispatch === true ? undefined : mayDispatch.pricing;
      let billedCalls: AnalysisBilledCall[] | undefined;
      try {
        const provider =
          dispatchPricing === undefined || options.providerForPricing === undefined
            ? options.provider
            : options.providerForPricing(dispatchPricing);
        const generated = await provider.generate({
          input: command.input,
          kind: command.kind,
        });
        billedCalls = generated.billedCalls;
        const output = practiceGenerationOutputSchema.parse(generated.output);
        if (output.kind !== command.kind) {
          throw new PracticeOutputValidationError();
        }
        return practiceGenerationOutputSchema.parse(
          await options.repository.complete({
            ...command,
            billedCalls: generated.billedCalls,
            output,
            ...(dispatchPricing === undefined ? {} : { pricing: dispatchPricing }),
            reservationId: acquired.reservationId,
          }),
        );
      } catch (error) {
        const providerFailure = error instanceof PracticeProviderError ? error : undefined;
        const failureCalls = billedCalls ?? providerFailure?.billedCalls;
        await options.repository.fail({
          ...command,
          ...(failureCalls === undefined ? {} : { billedCalls: failureCalls }),
          reservationId: acquired.reservationId,
          stableErrorCode:
            providerFailure?.stableErrorCode ??
            (error instanceof z.ZodError || error instanceof PracticeOutputValidationError
              ? "model_output_invalid"
              : "model_unavailable"),
        });
        return null;
      }
    },
  };
}

class PracticeOutputValidationError extends Error {}

export type PaidPracticeGenerator = ReturnType<typeof createPaidPracticeGenerator>;
