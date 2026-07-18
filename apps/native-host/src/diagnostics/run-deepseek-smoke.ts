import { homedir } from "node:os";
import { win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { analysisResultSchema, SCHEMA_VERSION } from "@huayi/protocol";
import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import { DeepSeekApiKeyReader } from "../credentials/deepseek-keychain.js";
import { WindowsDeepSeekApiKeyReader } from "../credentials/windows-deepseek-credential.js";
import { createMacosInstallationPaths } from "../install/paths.js";
import { createWindowsInstallationPaths } from "../install/windows-paths.js";
import type { AnalysisProvider } from "../provider/analysis-provider.js";
import { DeepSeekChatClient } from "../provider/deepseek-chat-client.js";
import {
  DeepSeekChatProvider,
  type DeepSeekCredentialReader,
} from "../provider/deepseek-chat-provider.js";
import { ModelSchemaRepository } from "../provider/model-schema-repository.js";
import type { ProviderValidationDiagnosticSink } from "../provider/provider-validation.js";
import { NodeProcessRunner, type ProcessRunner } from "../runtime/codex-process.js";
import { COMPARISON_CASES } from "./comparison-corpus.js";

const DEEPSEEK_CASES = [
  ...COMPARISON_CASES,
  {
    action: "translate",
    context: "hatch",
    id: "word-hatch-sanitized-context",
    selection: "hatch",
    selectionKind: "word",
    sentenceContext: null,
  },
] as const;

export interface DeepSeekSmokeTiming {
  readonly caseId: string;
  readonly completedMs: number;
  readonly firstVisibleMs: number;
}

export interface DeepSeekSmokeReport {
  readonly cancelled: number;
  readonly completed: number;
  readonly invalid: number;
  readonly model: "deepseek-v4-flash";
  readonly mode: "non-thinking";
  readonly timings: readonly DeepSeekSmokeTiming[];
}

export interface DeepSeekSmokeRuntime {
  createProvider(): AnalysisProvider;
  now?: () => number;
  writeReport(report: DeepSeekSmokeReport): void;
}

export interface DeepSeekSmokeCredentialReaderOptions {
  readonly environment: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly processRunner: ProcessRunner;
}

export function createDeepSeekSmokeCredentialReader(
  options: DeepSeekSmokeCredentialReaderOptions,
): DeepSeekCredentialReader {
  if (options.platform === "win32") {
    const localAppDataDirectory = options.environment.LOCALAPPDATA;
    const systemRoot = options.environment.SystemRoot;
    if (
      localAppDataDirectory === undefined ||
      localAppDataDirectory.trim().length === 0 ||
      systemRoot === undefined ||
      systemRoot.trim().length === 0
    ) {
      throw new Error("Windows DeepSeek smoke configuration is unavailable.");
    }
    const paths = createWindowsInstallationPaths(localAppDataDirectory);
    return new WindowsDeepSeekApiKeyReader({
      credentialHelperPath: paths.deepSeekCredentialHelperPath,
      credentialPath: paths.deepSeekCredentialPath,
      environment: options.environment,
      powershellExecutable: win32.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      processRunner: options.processRunner,
      workingDirectory: paths.workingDirectory,
    });
  }
  if (options.platform !== "darwin") {
    throw new Error("DeepSeek smoke requires macOS or Windows.");
  }
  const paths = createMacosInstallationPaths(options.homeDirectory);
  return new DeepSeekApiKeyReader({
    environment: options.environment,
    processRunner: options.processRunner,
    workingDirectory: paths.workingDirectory,
  });
}

function requestAt(index: number): AnalyzeRequest {
  const fixture = DEEPSEEK_CASES[index];
  if (fixture === undefined) throw new Error("DeepSeek smoke corpus is incomplete.");
  return {
    action: fixture.action,
    context: fixture.context,
    requestId: `deepseek-smoke-${String(index + 1).padStart(2, "0")}`,
    schemaVersion: SCHEMA_VERSION,
    selection: fixture.selection,
    selectionKind: fixture.selectionKind,
    sentenceContext: fixture.sentenceContext,
    targetLanguage: "zh-CN",
    type: "analyze",
  };
}

function expectedType(request: AnalyzeRequest): AnalysisResult["type"] {
  if (request.action === "translate") {
    if (request.selectionKind === "word") return "translate-word";
    return request.selectionKind === "phrase" ? "translate-lexical" : "translate-passage";
  }
  if (request.selectionKind === "word") return "explain-word";
  return request.selectionKind === "sentence" ? "explain-sentence" : "explain-lexical";
}

function validResult(result: unknown, request: AnalyzeRequest): boolean {
  const parsed = analysisResultSchema.safeParse(result);
  return (
    parsed.success &&
    parsed.data.sourceText === request.selection &&
    parsed.data.selectionKind === request.selectionKind &&
    parsed.data.type === expectedType(request)
  );
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

export async function runDeepSeekSmoke(runtime: DeepSeekSmokeRuntime): Promise<number> {
  const provider = runtime.createProvider();
  const now = runtime.now ?? performance.now.bind(performance);
  const signal = new AbortController().signal;
  const timings: DeepSeekSmokeTiming[] = [];
  let cancelled = 0;
  let completed = 0;
  let invalid = 0;
  try {
    for (let index = 0; index < DEEPSEEK_CASES.length; index += 1) {
      const request = requestAt(index);
      const startedAt = now();
      let firstVisibleMs: number | null = null;
      try {
        const result = await provider.analyze(request, signal, () => {
          firstVisibleMs ??= elapsed(now, startedAt);
        });
        if (!validResult(result, request) || firstVisibleMs === null) {
          invalid += 1;
          continue;
        }
        completed += 1;
        timings.push({
          caseId: `case-${String(index + 1).padStart(2, "0")}`,
          completedMs: elapsed(now, startedAt),
          firstVisibleMs,
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "CANCELLED"
        ) {
          cancelled += 1;
        } else {
          invalid += 1;
        }
      }
    }
  } finally {
    provider.dispose?.();
  }
  runtime.writeReport({
    cancelled,
    completed,
    invalid,
    mode: "non-thinking",
    model: "deepseek-v4-flash",
    timings,
  });
  return completed === DEEPSEEK_CASES.length ? 0 : 1;
}

export function createDefaultDeepSeekSmokeRuntime(
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
  moduleUrl = import.meta.url,
  onValidationDiagnostic?: ProviderValidationDiagnosticSink,
  platform: NodeJS.Platform = process.platform,
): DeepSeekSmokeRuntime {
  const processRunner = new NodeProcessRunner();
  const apiKeyReader = createDeepSeekSmokeCredentialReader({
    environment,
    homeDirectory,
    platform,
    processRunner,
  });
  const schemaRepository = new ModelSchemaRepository({
    schemaDirectory: fileURLToPath(new URL("../provider/schemas/", moduleUrl)),
  });
  return {
    createProvider: () =>
      new DeepSeekChatProvider({
        apiKeyReader,
        client: new DeepSeekChatClient(),
        ...(onValidationDiagnostic === undefined ? {} : { onValidationDiagnostic }),
        schemaRepository,
      }),
    writeReport: (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
  };
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && pathToFileURL(entrypoint).href === import.meta.url;
}

if (isDirectExecution()) {
  if (process.argv.length !== 2) {
    process.stderr.write("DeepSeek smoke does not accept arguments; it uses fixed cases.\n");
    process.exitCode = 1;
  } else {
    void runDeepSeekSmoke(createDefaultDeepSeekSmokeRuntime(process.env, homedir())).then(
      (exitCode) => {
        process.exitCode = exitCode;
      },
      () => {
        process.stderr.write("DeepSeek smoke failed.\n");
        process.exitCode = 1;
      },
    );
  }
}
