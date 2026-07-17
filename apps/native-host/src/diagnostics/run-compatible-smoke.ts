import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { analysisResultSchema, SCHEMA_VERSION } from "@huayi/protocol";
import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import type { CompatibleHttpConfiguration } from "../config/compatible-http-configuration.js";
import { CompatibleHttpConfigurationStore } from "../config/compatible-http-configuration-store.js";
import { CompatibleHttpApiKeyReader } from "../credentials/compatible-http-keychain.js";
import { createMacosInstallationPaths } from "../install/paths.js";
import type { AnalysisProvider } from "../provider/analysis-provider.js";
import { CompatibleHttpResponsesClient } from "../provider/compatible-http-responses-client.js";
import { CompatibleHttpResponsesProvider } from "../provider/compatible-http-responses-provider.js";
import { ModelSchemaRepository } from "../provider/model-schema-repository.js";
import { NodeProcessRunner } from "../runtime/codex-process.js";
import { COMPARISON_CASES } from "./comparison-corpus.js";

export interface AnonymousTiming {
  readonly caseId: string;
  readonly completedMs: number;
  readonly firstDeltaMs: number;
}

export type CompatibleSmokeProfileId =
  "compatible-gpt-5.4-mini-low" | "compatible-gpt-5.6-luna-none";

export interface CompatibleSmokeReport {
  readonly cancelled: number;
  readonly completed: number;
  readonly invalid: number;
  readonly profiles: readonly [
    { readonly cases: readonly AnonymousTiming[]; readonly id: CompatibleSmokeProfileId },
  ];
}

export interface CompatibleSmokeRuntime {
  createProvider(configuration: CompatibleHttpConfiguration): AnalysisProvider;
  now?: () => number;
  readConfiguration(signal: AbortSignal): Promise<CompatibleHttpConfiguration>;
  writeReport(report: CompatibleSmokeReport): void;
}

function profileId(configuration: CompatibleHttpConfiguration): CompatibleSmokeProfileId {
  return configuration.model === "gpt-5.4-mini"
    ? "compatible-gpt-5.4-mini-low"
    : "compatible-gpt-5.6-luna-none";
}

function requestAt(index: number): AnalyzeRequest {
  const fixture = COMPARISON_CASES[index];
  if (fixture === undefined) throw new Error("Compatible smoke corpus is incomplete.");
  return {
    action: fixture.action,
    context: fixture.context,
    requestId: `compatible-smoke-${String(index + 1).padStart(2, "0")}`,
    schemaVersion: SCHEMA_VERSION,
    selection: fixture.selection,
    selectionKind: fixture.selectionKind,
    sentenceContext: fixture.sentenceContext,
    targetLanguage: "zh-CN",
    type: "analyze",
  };
}

function expectedResultType(request: AnalyzeRequest): AnalysisResult["type"] {
  if (request.action === "translate") {
    if (request.selectionKind === "word") return "translate-word";
    return request.selectionKind === "phrase" ? "translate-lexical" : "translate-passage";
  }
  if (request.selectionKind === "word") return "explain-word";
  return request.selectionKind === "sentence" ? "explain-sentence" : "explain-lexical";
}

function isStrictResult(result: unknown, request: AnalyzeRequest): boolean {
  const parsed = analysisResultSchema.safeParse(result);
  return (
    parsed.success &&
    parsed.data.sourceText === request.selection &&
    parsed.data.selectionKind === request.selectionKind &&
    parsed.data.type === expectedResultType(request)
  );
}

function isCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "CANCELLED"
  );
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

export async function runConfiguredCompatibleSmoke(
  runtime: CompatibleSmokeRuntime,
): Promise<number> {
  const signal = new AbortController().signal;
  const configuration = await runtime.readConfiguration(signal);
  const provider = runtime.createProvider(configuration);
  const now = runtime.now ?? performance.now.bind(performance);
  let cancelled = 0;
  let completed = 0;
  let invalid = 0;
  const cases: AnonymousTiming[] = [];
  try {
    for (let index = 0; index < COMPARISON_CASES.length; index += 1) {
      const request = requestAt(index);
      const startedAt = now();
      let firstDeltaMs: number | null = null;
      try {
        const result = await provider.analyze(request, signal, () => {
          firstDeltaMs ??= elapsed(now, startedAt);
        });
        if (!isStrictResult(result, request) || firstDeltaMs === null) {
          invalid += 1;
          continue;
        }
        completed += 1;
        cases.push({
          caseId: `case-${String(index + 1).padStart(2, "0")}`,
          completedMs: elapsed(now, startedAt),
          firstDeltaMs,
        });
      } catch (error) {
        if (isCancelled(error)) cancelled += 1;
        else invalid += 1;
      }
    }
  } finally {
    provider.dispose?.();
  }
  const report: CompatibleSmokeReport = {
    cancelled,
    completed,
    invalid,
    profiles: [{ cases, id: profileId(configuration) }],
  };
  runtime.writeReport(report);
  return completed === COMPARISON_CASES.length ? 0 : 1;
}

export interface DefaultCompatibleSmokeRuntimeOptions {
  readonly environment: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly moduleUrl?: string;
}

export function createDefaultCompatibleSmokeRuntime(
  options: DefaultCompatibleSmokeRuntimeOptions,
): CompatibleSmokeRuntime {
  const paths = createMacosInstallationPaths(options.homeDirectory);
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const configurationStore = new CompatibleHttpConfigurationStore(
    paths.compatibleHttpConfigurationPath,
  );
  const processRunner = new NodeProcessRunner();
  const apiKeyReader = new CompatibleHttpApiKeyReader({
    environment: options.environment,
    processRunner,
    workingDirectory: paths.workingDirectory,
  });
  const schemaRepository = new ModelSchemaRepository({
    schemaDirectory: fileURLToPath(new URL("../provider/schemas/", moduleUrl)),
  });
  return {
    createProvider: (compatibleConfiguration) =>
      new CompatibleHttpResponsesProvider({
        apiKeyReader,
        client: new CompatibleHttpResponsesClient(),
        configurationStore: { read: async () => compatibleConfiguration },
        schemaRepository,
      }),
    readConfiguration: (signal) => configurationStore.read(signal),
    writeReport: (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
  };
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  if (process.argv.length !== 2) {
    process.stderr.write("Compatible smoke does not accept arguments; it uses fixed cases.\n");
    process.exitCode = 1;
  } else {
    void runConfiguredCompatibleSmoke(
      createDefaultCompatibleSmokeRuntime({
        environment: process.env,
        homeDirectory: homedir(),
      }),
    ).then(
      (exitCode) => {
        process.exitCode = exitCode;
      },
      () => {
        process.stderr.write("Compatible smoke failed.\n");
        process.exitCode = 1;
      },
    );
  }
}
