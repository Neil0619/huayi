import {
  inputSchemaByKind,
  practiceInstructions,
  parsePracticeProviderOutput,
} from "./deepseek-practice-contract.js";
import { modelDeadline } from "./model-execution.js";
import { createTextModelPreview } from "./text-model-preview.js";
import { calculateModelCost, modelPriceSchema, type ModelPrice } from "@huayi/cloud-contracts";

import type { AnalysisBilledCall } from "./analysis-ports.js";
import {
  DEEPSEEK_PLATFORM_ENDPOINT,
  DEEPSEEK_PLATFORM_MODEL,
  DeepSeekAnalysisModelError,
  parseDeepSeekAnalysisResponse,
  type DeepSeekAnalysisFetch,
  type DeepSeekAnalysisFetchInit,
  type DeepSeekAnalysisFetchResponse,
} from "./deepseek-analysis-protocol.js";
import {
  PracticeProviderError,
  type PracticeGenerationKind,
  type PracticeProvider,
} from "./paid-practice-generator.js";

const MAXIMUM_REQUEST_BYTES = 64 * 1_024;
const MAXIMUM_REPAIR_CHARACTERS = 16_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const outputLimitByKind: Record<PracticeGenerationKind, number> = {
  "dialogue-assistant": 1_024,
  "dialogue-final-feedback": 4_096,
  "dialogue-start": 2_048,
  "sentence-feedback": 2_048,
  "sentence-prompt": 1_024,
};

interface DeepSeekPracticeProviderOptions {
  apiKey: string;
  fetch?: DeepSeekAnalysisFetch;
  prices: ModelPrice | (() => Promise<ModelPrice>);
  timeoutMs?: number;
}

function defaultFetch(
  url: string,
  init: DeepSeekAnalysisFetchInit,
): Promise<DeepSeekAnalysisFetchResponse> {
  return fetch(url, init);
}

function requestBody(
  kind: PracticeGenerationKind,
  input: Record<string, unknown>,
  repair?: string,
) {
  const messages = [
    { content: practiceInstructions(kind, input), role: "system" },
    {
      content: `UNTRUSTED_INPUT_BEGIN\n${JSON.stringify(input)}\nUNTRUSTED_INPUT_END`,
      role: "user",
    },
  ];
  if (repair !== undefined) {
    messages.push({
      content: `Repair the JSON structure and required language only. Preserve the practice target and meaning; follow the system's language and scenario requirements.\nINVALID_OUTPUT_BEGIN\n${repair.slice(0, MAXIMUM_REPAIR_CHARACTERS)}\nINVALID_OUTPUT_END`,
      role: "user",
    });
  }
  const body = JSON.stringify({
    max_tokens: outputLimitByKind[kind],
    messages,
    model: DEEPSEEK_PLATFORM_MODEL,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0,
    thinking: { type: kind.endsWith("feedback") ? "enabled" : "disabled" },
  });
  if (new TextEncoder().encode(body).byteLength > MAXIMUM_REQUEST_BYTES) {
    throw new PracticeProviderError("model_output_invalid");
  }
  return body;
}

export function deepSeekPracticeMaximumUsage(kind: PracticeGenerationKind) {
  return { inputTokens: 131_072, outputTokens: outputLimitByKind[kind] * 2 };
}

export function createDeepSeekPracticeProvider(
  options: DeepSeekPracticeProviderOptions,
): PracticeProvider {
  if (options.apiKey.trim() === "") throw new PracticeProviderError("model_unavailable");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new PracticeProviderError("model_unavailable");
  }
  const providerFetch = options.fetch ?? defaultFetch;
  return {
    async generate(command) {
      const input: Record<string, unknown> = inputSchemaByKind[command.kind].parse(command.input);
      const prices = modelPriceSchema.parse(
        typeof options.prices === "function" ? await options.prices() : options.prices,
      );
      const controller = modelDeadline(timeoutMs, command.signal);
      let firstToken = false;
      const preview = createTextModelPreview(
        new Set(["prompt", "feedback", "assistantTurn", "opener", "summary"]),
        command,
      );
      const call = async (repair?: string) => {
        try {
          await command.beforeDispatch?.();
          controller.signal.throwIfAborted();
        } catch {
          throw new PracticeProviderError("model_unavailable", []);
        }
        let response: DeepSeekAnalysisFetchResponse;
        try {
          response = await providerFetch(DEEPSEEK_PLATFORM_ENDPOINT, {
            body: requestBody(command.kind, input, repair),
            credentials: "omit",
            headers: {
              Accept: "text/event-stream, application/json",
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            redirect: "error",
            signal: controller.signal,
          });
        } catch {
          throw new PracticeProviderError("model_unavailable");
        }
        if (response.status !== 200) {
          try {
            await response.body?.cancel();
          } catch {
            // Provider error content is deliberately discarded.
          }
          throw new PracticeProviderError("model_unavailable");
        }
        if (
          !["application/json", "text/event-stream"].includes(
            response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "",
          )
        ) {
          throw new PracticeProviderError("model_unavailable");
        }
        try {
          const result = await parseDeepSeekAnalysisResponse(
            response,
            controller.signal,
            (text) => {
              if (repair === undefined && input["teachingContract"] === undefined) preview(text);
            },
            () => {
              if (!firstToken) {
                firstToken = true;
                command.onTiming?.("provider-first-token");
              }
            },
          );
          command.onTiming?.(repair === undefined ? "generation-complete" : "repair-complete");
          return result;
        } catch (error) {
          throw new PracticeProviderError(
            error instanceof DeepSeekAnalysisModelError && error.code === "model_output_invalid"
              ? "model_output_invalid"
              : "model_unavailable",
            error instanceof DeepSeekAnalysisModelError && error.usage
              ? [{ costMicroUsd: calculateModelCost(error.usage, prices), usage: error.usage }]
              : undefined,
          );
        }
      };
      try {
        const first = await call();
        const firstBilled: AnalysisBilledCall = {
          costMicroUsd: calculateModelCost(first.usage, prices),
          usage: first.usage,
        };
        const firstOutput = parsePracticeProviderOutput(first.content, {
          kind: command.kind,
          input,
        });
        if (firstOutput !== null) return { billedCalls: [firstBilled], output: firstOutput };
        let second;
        try {
          command.onTiming?.("repair-start");
          second = await call(first.content);
        } catch (error) {
          throw new PracticeProviderError(
            error instanceof PracticeProviderError ? error.stableErrorCode : "model_unavailable",
            [
              firstBilled,
              ...(error instanceof PracticeProviderError ? (error.billedCalls ?? []) : []),
            ],
          );
        }
        const secondBilled: AnalysisBilledCall = {
          costMicroUsd: calculateModelCost(second.usage, prices),
          usage: second.usage,
        };
        const secondOutput = parsePracticeProviderOutput(second.content, {
          kind: command.kind,
          input,
        });
        if (secondOutput === null) {
          throw new PracticeProviderError("model_output_invalid", [firstBilled, secondBilled]);
        }
        return { billedCalls: [firstBilled, secondBilled], output: secondOutput };
      } finally {
        controller.dispose();
      }
    },
  };
}
