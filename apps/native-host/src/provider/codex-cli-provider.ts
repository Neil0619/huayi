import { isAbsolute, join } from "node:path";

import { analysisResultSchema } from "@huayi/protocol";
import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import {
  ProcessAbortedError,
  ProcessOutputLimitError,
  ProcessSpawnError,
  ProcessTimeoutError,
  buildAllowedEnvironment,
  type ProcessRunner,
} from "../runtime/codex-process.js";
import {
  CodexProviderError,
  capabilityMissingError,
  invalidResponseError,
  mapCodexProcessFailure,
} from "../runtime/error-mapper.js";
import type { AnalysisProvider } from "./analysis-provider.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";

const REQUEST_TIMEOUT_MS = 60_000;

export interface CodexCliProviderOptions {
  codexExecutable: string;
  environment: NodeJS.ProcessEnv;
  processRunner: ProcessRunner;
  schemaDirectory: string;
  workingDirectory: string;
}

export function outputSchemaFilenameFor(
  request: Pick<AnalyzeRequest, "action" | "selectionKind">,
): string {
  if (request.action === "translate") {
    return ["word", "phrase"].includes(request.selectionKind)
      ? "translate-lexical.json"
      : "translate-passage.json";
  }
  if (["word", "phrase"].includes(request.selectionKind)) {
    return "explain-lexical.json";
  }
  if (request.selectionKind === "sentence") {
    return "explain-sentence.json";
  }
  throw new CodexProviderError("UNSUPPORTED_SELECTION", "当前选区不支持该操作。", false);
}

function expectedResultType(request: AnalyzeRequest): AnalysisResult["type"] {
  const filename = outputSchemaFilenameFor(request);
  return filename.slice(0, -".json".length) as AnalysisResult["type"];
}

function parseResult(stdout: string, request: AnalyzeRequest): AnalysisResult {
  let rawResult: unknown;
  try {
    rawResult = JSON.parse(stdout);
  } catch (error) {
    throw invalidResponseError(error);
  }

  const parsed = analysisResultSchema.safeParse(rawResult);
  if (!parsed.success) {
    throw invalidResponseError(parsed.error);
  }

  if (
    parsed.data.type !== expectedResultType(request) ||
    parsed.data.selectionKind !== request.selectionKind ||
    parsed.data.sourceText !== request.selection
  ) {
    throw invalidResponseError();
  }
  return parsed.data;
}

function mapRunnerError(error: unknown): CodexProviderError {
  if (error instanceof ProcessAbortedError) {
    return mapCodexProcessFailure({ aborted: true, exitCode: null, stderr: "" });
  }
  if (error instanceof ProcessTimeoutError) {
    return mapCodexProcessFailure({ exitCode: null, stderr: "", timedOut: true });
  }
  if (error instanceof ProcessOutputLimitError) {
    return invalidResponseError(error);
  }
  if (error instanceof ProcessSpawnError) {
    return capabilityMissingError(error);
  }
  return mapCodexProcessFailure({ exitCode: null, stderr: "" });
}

export class CodexCliProvider implements AnalysisProvider {
  private readonly codexExecutable: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly processRunner: ProcessRunner;
  private readonly schemaDirectory: string;
  private readonly workingDirectory: string;

  constructor(options: CodexCliProviderOptions) {
    if (!isAbsolute(options.schemaDirectory) || !isAbsolute(options.workingDirectory)) {
      throw new TypeError("Codex schema and working directories must be absolute paths.");
    }
    this.codexExecutable = options.codexExecutable;
    this.environment = buildAllowedEnvironment(options.environment);
    this.processRunner = options.processRunner;
    this.schemaDirectory = options.schemaDirectory;
    this.workingDirectory = options.workingDirectory;
  }

  async analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<AnalysisResult> {
    const outputSchema = join(this.schemaDirectory, outputSchemaFilenameFor(request));
    let processResult;
    try {
      processResult = await this.processRunner.run({
        arguments: [
          "exec",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--strict-config",
          "--disable",
          "shell_tool",
          "--disable",
          "unified_exec",
          "--disable",
          "shell_snapshot",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--output-schema",
          outputSchema,
          "--color",
          "never",
          "--config",
          'approval_policy="never"',
          "--config",
          'web_search="disabled"',
          "--config",
          'model_reasoning_effort="low"',
          "--config",
          'history.persistence="none"',
          "--config",
          'shell_environment_policy.inherit="none"',
          "--cd",
          this.workingDirectory,
          "-",
        ],
        cwd: this.workingDirectory,
        env: this.environment,
        executable: this.codexExecutable,
        input: buildAnalysisPrompt(request),
        signal,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw mapRunnerError(error);
    }

    if (processResult.exitCode !== 0 || processResult.signal !== null) {
      throw mapCodexProcessFailure({
        exitCode: processResult.exitCode,
        stderr: processResult.stderr,
      });
    }
    return parseResult(processResult.stdout, request);
  }
}
