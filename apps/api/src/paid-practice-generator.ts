import {
  captureDiagnostic,
  setDiagnosticContext,
  setDiagnosticOperationIfAbsent,
} from "./diagnostic-context.js";
import { z } from "zod/v3";

import type { AnalysisBilledCall } from "./analysis-ports.js";
import type { DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";
import type { ModelExecution } from "./model-execution.js";

import {
  parsePracticeGenerationOutput,
  PracticeOutputValidationError,
  type PracticeGenerationOutput,
  type PracticeGenerationKind,
} from "./practice-generation-output.js";
export {
  practiceGenerationOutputSchema,
  type PracticeGenerationOutput,
  type PracticeGenerationKind,
} from "./practice-generation-output.js";

export interface PracticeGenerationCommand extends ModelExecution {
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
  generate(command: Pick<PracticeGenerationCommand, "input" | "kind"> & ModelExecution): Promise<{
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
      setDiagnosticOperationIfAbsent(
        command.kind === "sentence-prompt"
          ? "sentence-start"
          : command.kind === "sentence-feedback"
            ? "sentence-submit"
            : command.kind === "dialogue-start"
              ? "dialogue-start"
              : command.kind === "dialogue-assistant"
                ? "dialogue-turn"
                : "dialogue-finish",
      );
      setDiagnosticContext({ generationId: command.generationId, userId: command.ownerUserId });
      const acquired = await options.repository.acquire(command);
      if (acquired.kind === "pending") return null;
      if (acquired.kind === "ready") return parsePracticeGenerationOutput(acquired.output, command);
      const mayDispatch = await options.repository.markDispatched({
        ...command,
        reservationId: acquired.reservationId,
      });
      if (!mayDispatch) return null;
      const dispatchPricing = mayDispatch === true ? undefined : mayDispatch.pricing;
      let billedCalls: AnalysisBilledCall[] | undefined;
      let output: PracticeGenerationOutput;
      try {
        const provider =
          dispatchPricing === undefined || options.providerForPricing === undefined
            ? options.provider
            : options.providerForPricing(dispatchPricing);
        const generated = await provider.generate({
          ...(command.beforeDispatch ? { beforeDispatch: command.beforeDispatch } : {}),
          ...(command.signal ? { signal: command.signal } : {}),
          ...(command.onPreview ? { onPreview: command.onPreview } : {}),
          ...(command.onTiming ? { onTiming: command.onTiming } : {}),
          input: command.input,
          kind: command.kind,
        });
        billedCalls = generated.billedCalls;
        output = parsePracticeGenerationOutput(generated.output, command);
      } catch (error) {
        const providerFailure = error instanceof PracticeProviderError ? error : undefined;
        const failureCalls = billedCalls ?? providerFailure?.billedCalls;
        if (!command.signal?.aborted)
          captureDiagnostic({
            code:
              providerFailure?.stableErrorCode ??
              (error instanceof z.ZodError || error instanceof PracticeOutputValidationError
                ? "model_output_invalid"
                : "model_unavailable"),
            stage: "model",
            provider: "deepseek",
          });
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
      // A storage/settlement response can be lost after commit. Let the task reconcile it;
      // do not relabel it as provider failure or discard an already billed ready result.
      return parsePracticeGenerationOutput(
        await options.repository.complete({
          ...command,
          billedCalls: billedCalls ?? [],
          output,
          ...(dispatchPricing === undefined ? {} : { pricing: dispatchPricing }),
          reservationId: acquired.reservationId,
        }),
        command,
      );
    },
  };
}

export type PaidPracticeGenerator = ReturnType<typeof createPaidPracticeGenerator>;
