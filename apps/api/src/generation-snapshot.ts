import { createHash } from "node:crypto";
import { z } from "zod/v3";
import {
  extensionQueryGenerationRequestSchema,
  learningTaskCommandReadSchema,
  platformAnalysisGenerationIdentity,
  platformQueryGenerationIdentity,
  type ExtensionQueryGenerationRequest,
  type LearningTaskCommandRead,
} from "@huayi/cloud-contracts";
import { buildDeepSeekAnalysisRequest } from "./deepseek-analysis-protocol.js";
import { buildDeepSeekQueryRequest } from "./deepseek-extension-query-model.js";
import { reviewedGrammarConfiguration } from "./deepseek-analysis-reference.js";
import { analysisSourceUnits } from "./analysis-segmentation.js";
import { CloudFault } from "./cloud-fault.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const snapshotSchema = z.strictObject({
  version: z.literal(1),
  identity: z.strictObject({
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    schemaVersion: z.number().int(),
    resultType: z.string(),
    outputContract: z.string(),
  }),
  inputHash: digestSchema,
  configurationDigest: digestSchema,
  executionDigest: digestSchema,
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function structured(input: object) {
  return "outputContract" in input;
}

function analysisConfiguration() {
  // Hash the actual first and repair request builders for both possible capture kinds.
  // These fixed inert sources never leave this process or invoke a provider.
  return {
    grammar: reviewedGrammarConfiguration(),
    requests: (["phrase", "sentence"] as const).map((selectionKind) => {
      const input = {
        outputContract: "structured-teaching-v1" as const,
        selectionKind,
        source: { type: "manual" as const },
        sourceText: "We can.",
      };
      const units = analysisSourceUnits(input);
      return [
        buildDeepSeekAnalysisRequest(input, units),
        buildDeepSeekAnalysisRequest(input, units, "{}"),
      ];
    }),
  };
}
function queryConfiguration(input: ExtensionQueryGenerationRequest) {
  return [
    buildDeepSeekQueryRequest(input),
    buildDeepSeekQueryRequest(input, undefined, {
      content: "{}",
      failure: { stage: "json", issues: [], issuesTruncated: false },
    }),
  ];
}
function snapshot(
  input: unknown,
  identity: z.infer<typeof snapshotSchema>["identity"],
  configuration: unknown,
) {
  const core = {
    version: 1 as const,
    identity,
    inputHash: digest(input),
    configurationDigest: digest(configuration),
  };
  return { ...core, executionDigest: digest(core) };
}
function taskSnapshot(command: LearningTaskCommandRead) {
  if (!structured(command.input)) return undefined;
  if (command.kind === "instant-query")
    return snapshot(
      command,
      platformQueryGenerationIdentity(command.input),
      queryConfiguration(command.input),
    );
  if (command.kind === "analysis" || command.kind === "capture-analysis")
    return snapshot(command, platformAnalysisGenerationIdentity(true), analysisConfiguration());
  return undefined;
}
function querySnapshot(input: ExtensionQueryGenerationRequest) {
  return structured(input)
    ? snapshot(input, platformQueryGenerationIdentity(input), queryConfiguration(input))
    : undefined;
}
function unwrap(value: unknown) {
  const parsed = z.record(z.unknown()).parse(value);
  const { _generation: generationSnapshot, ...publicInput } = parsed;
  return { publicInput, generationSnapshot };
}
function assertSnapshot(expected: ReturnType<typeof taskSnapshot>, value: unknown) {
  if (expected === undefined) return;
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || digest(parsed.data) !== digest(expected))
    throw new CloudFault(
      "model_unavailable",
      "The saved generation configuration is unavailable. Start a new task.",
    );
}

export function storedTaskCommand(command: LearningTaskCommandRead) {
  const parsed = learningTaskCommandReadSchema.parse(command);
  const saved = taskSnapshot(parsed);
  return saved === undefined ? parsed : { ...parsed, _generation: saved };
}
export function readStoredTaskCommand(value: unknown) {
  const { publicInput, generationSnapshot } = unwrap(value);
  return { command: learningTaskCommandReadSchema.parse(publicInput), generationSnapshot };
}
export function validateTaskGeneration(
  command: LearningTaskCommandRead,
  generationSnapshot: unknown,
) {
  assertSnapshot(taskSnapshot(command), generationSnapshot);
}
export function storedQueryRequest(input: ExtensionQueryGenerationRequest) {
  const parsed = extensionQueryGenerationRequestSchema.parse(input);
  const saved = querySnapshot(parsed);
  return saved === undefined ? parsed : { ...parsed, _generation: saved };
}
export function readStoredQueryRequest(value: unknown) {
  // Public exports/readback remain valid across deployments, even after configuration changes.
  return extensionQueryGenerationRequestSchema.parse(unwrap(value).publicInput);
}
export function validateStoredQueryGeneration(value: unknown) {
  const { publicInput, generationSnapshot } = unwrap(value);
  const input = extensionQueryGenerationRequestSchema.parse(publicInput);
  assertSnapshot(querySnapshot(input), generationSnapshot);
}
