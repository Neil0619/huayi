import { createHash } from "node:crypto";

import {
  duplicateSuggestionsResponseSchema,
  learningItemDetailResponseSchema,
  modelUsageSchema,
  type DuplicateSuggestionsResponse,
  type LearningItemContent,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import type { AnalysisBilledCall } from "./analysis-ports.js";
import { CloudFault } from "./cloud-fault.js";
import type { DeepSeekPriceSchedule, DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";

const PROMPT_VERSION = "learning-duplicate-suggestions-v1";
const OUTPUT_SCHEMA_VERSION = "learning-duplicate-suggestions-v1";
const candidateAliasSchema = z.string().trim().min(1).max(64);
const billedCallSchema = z.strictObject({
  costMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  usage: modelUsageSchema,
});
const billedCallsSchema = z.array(billedCallSchema).max(1);
const providerSuggestionsSchema = z
  .array(
    z.strictObject({
      alias: candidateAliasSchema,
      confidence: z.number().min(0).max(1),
      reasonZh: z.string().trim().min(1).max(500),
    }),
  )
  .max(10);

export interface DuplicateSuggestionCommand {
  candidates: LearningItemDetailResponse[];
  idempotencyKey: string;
  ownerUserId: string;
  source: LearningItemDetailResponse;
}

interface CandidateAlias {
  alias: string;
  itemId: string;
  itemRevision: number;
}

interface DuplicateSuggestionGenerationCommon {
  idempotencyKey: string;
  leaseToken: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
  requestId: string;
  sourceItemId: string;
  sourceRevision: number;
}

export interface BeginDuplicateSuggestionGenerationCommand extends DuplicateSuggestionGenerationCommon {
  candidateAliases: CandidateAlias[];
  reservedMicroUsd: number;
}

export interface DuplicateSuggestionGenerationLeaseCommand extends DuplicateSuggestionGenerationCommon {
  dispatchedAt?: string;
  pricing?: DeepSeekPriceSnapshot;
  reservationId: string;
}

export interface CompleteDuplicateSuggestionGenerationCommand extends DuplicateSuggestionGenerationLeaseCommand {
  billedCalls: AnalysisBilledCall[];
  response: DuplicateSuggestionsResponse;
}

export interface FailDuplicateSuggestionGenerationCommand extends DuplicateSuggestionGenerationLeaseCommand {
  billedCalls?: AnalysisBilledCall[];
  stableErrorCode: DuplicateSuggestionProviderErrorCode;
}

type BeginDuplicateSuggestionGenerationResult =
  | { kind: "acquired"; reservationId: string }
  | { kind: "busy" }
  | { kind: "resolved"; response: DuplicateSuggestionsResponse };

export interface DuplicateSuggestionGenerationRepository {
  begin(
    command: BeginDuplicateSuggestionGenerationCommand,
  ): Promise<BeginDuplicateSuggestionGenerationResult>;
  complete(
    command: CompleteDuplicateSuggestionGenerationCommand,
  ): Promise<DuplicateSuggestionsResponse>;
  fail(command: FailDuplicateSuggestionGenerationCommand): Promise<void>;
  markDispatched(command: DuplicateSuggestionGenerationLeaseCommand): Promise<boolean>;
}

export interface DuplicateSuggestionProvider {
  generate(input: {
    candidates: { alias: string; content: LearningItemContent }[];
    source: { content: LearningItemContent };
  }): Promise<{ billedCalls: AnalysisBilledCall[]; suggestions: unknown }>;
}

type DuplicateSuggestionProviderErrorCode = "model_output_invalid" | "model_unavailable";

export class DuplicateSuggestionProviderError extends Error {
  readonly billedCalls?: AnalysisBilledCall[];
  readonly stableErrorCode: DuplicateSuggestionProviderErrorCode;

  constructor(
    stableErrorCode: DuplicateSuggestionProviderErrorCode,
    billedCalls?: AnalysisBilledCall[],
  ) {
    super("The duplicate suggestion provider request failed.");
    this.name = "DuplicateSuggestionProviderError";
    this.stableErrorCode = stableErrorCode;
    if (billedCalls !== undefined) this.billedCalls = billedCalls;
  }
}

function requestHash(sourceItemId: string, sourceRevision: number): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        sourceItemId,
        sourceRevision,
      }),
    )
    .digest("hex");
}

function publicProviderFault(code: DuplicateSuggestionProviderErrorCode): CloudFault {
  return code === "model_output_invalid"
    ? new CloudFault("model_output_invalid", "The model output was invalid.")
    : new CloudFault("model_unavailable", "The model is temporarily unavailable.");
}

export function createPaidDuplicateSuggestionGenerator(options: {
  enabled: () => boolean;
  newId: () => string;
  now: () => Date;
  provider: DuplicateSuggestionProvider;
  providerForPricing?: (pricing: DeepSeekPriceSnapshot) => DuplicateSuggestionProvider;
  pricing?: DeepSeekPriceSchedule;
  repository: DuplicateSuggestionGenerationRepository;
  reservedMicroUsd: number;
}) {
  return {
    async suggest(command: DuplicateSuggestionCommand): Promise<DuplicateSuggestionsResponse> {
      const source = learningItemDetailResponseSchema.parse(command.source);
      const candidates = z
        .array(learningItemDetailResponseSchema)
        .max(50)
        .parse(command.candidates);
      if (candidates.length === 0) {
        return { itemRevision: source.item.revision, suggestions: [] };
      }
      if (!options.enabled()) {
        throw new CloudFault("model_unavailable", "Duplicate suggestions are disabled.");
      }
      const aliases = candidates.map((candidate, index) => ({
        alias: `candidate-${index + 1}`,
        candidate,
      }));
      const common: DuplicateSuggestionGenerationCommon = {
        idempotencyKey: command.idempotencyKey,
        requestId: options.newId(),
        leaseToken: options.newId(),
        now: options.now().toISOString(),
        ownerUserId: command.ownerUserId,
        requestHash: requestHash(source.item.id, source.item.revision),
        sourceItemId: source.item.id,
        sourceRevision: source.item.revision,
      };
      const acquired = await options.repository.begin({
        ...common,
        candidateAliases: aliases.map(({ alias, candidate }) => ({
          alias,
          itemId: candidate.item.id,
          itemRevision: candidate.item.revision,
        })),
        reservedMicroUsd: options.reservedMicroUsd,
      });
      if (acquired.kind === "busy") {
        throw new CloudFault("generation_busy", "Duplicate suggestion generation is active.");
      }
      if (acquired.kind === "resolved") {
        const replay = duplicateSuggestionsResponseSchema.safeParse(acquired.response);
        if (!replay.success) throw publicProviderFault("model_output_invalid");
        return replay.data;
      }
      const leaseCommand: DuplicateSuggestionGenerationLeaseCommand = {
        ...common,
        reservationId: acquired.reservationId,
      };
      const dispatchedAt = options.now();
      const dispatchPricing = options.pricing?.at(dispatchedAt);
      const dispatchedCommand = {
        ...leaseCommand,
        ...(dispatchPricing === undefined
          ? {}
          : { dispatchedAt: dispatchedAt.toISOString(), pricing: dispatchPricing }),
      };
      if (!(await options.repository.markDispatched(dispatchedCommand))) {
        throw new CloudFault("generation_busy", "Duplicate suggestion generation lost its lease.");
      }

      let billedCalls: AnalysisBilledCall[] | undefined;
      try {
        const provider =
          dispatchPricing === undefined || options.providerForPricing === undefined
            ? options.provider
            : options.providerForPricing(dispatchPricing);
        const generated = await provider.generate({
          candidates: aliases.map(({ alias, candidate }) => ({
            alias,
            content: candidate.item.content,
          })),
          source: { content: source.item.content },
        });
        billedCalls = billedCallsSchema.parse(generated.billedCalls);
        const suggestions = providerSuggestionsSchema.parse(generated.suggestions);
        const candidatesByAlias = new Map(
          aliases.map(({ alias, candidate }) => [alias, candidate] as const),
        );
        const seen = new Set<string>();
        const response = duplicateSuggestionsResponseSchema.parse({
          itemRevision: source.item.revision,
          suggestions: suggestions.flatMap(({ alias, ...suggestion }) => {
            const candidate = candidatesByAlias.get(alias);
            if (candidate === undefined || seen.has(alias)) return [];
            seen.add(alias);
            return [{ ...suggestion, candidate }];
          }),
        });
        return duplicateSuggestionsResponseSchema.parse(
          await options.repository.complete({
            ...dispatchedCommand,
            billedCalls,
            response,
          }),
        );
      } catch (error) {
        const providerError = error instanceof DuplicateSuggestionProviderError ? error : undefined;
        const stableErrorCode =
          providerError?.stableErrorCode ??
          (error instanceof z.ZodError ? "model_output_invalid" : "model_unavailable");
        const failureCalls = billedCalls ?? providerError?.billedCalls;
        await options.repository.fail({
          ...dispatchedCommand,
          ...(failureCalls === undefined ? {} : { billedCalls: failureCalls }),
          stableErrorCode,
        });
        throw publicProviderFault(stableErrorCode);
      }
    },
  };
}

export type PaidDuplicateSuggestionGenerator = ReturnType<
  typeof createPaidDuplicateSuggestionGenerator
>;
