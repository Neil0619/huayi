import { describe, expect, it } from "vitest";

import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "../runtime/codex-process.js";
import { CodexCliProvider, outputSchemaFilenameFor } from "./codex-cli-provider.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "provider-1",
  schemaVersion: 1,
  selection: "investigation",
  selectionKind: "word",
  targetLanguage: "zh-CN",
  type: "analyze",
};

const validResult: AnalysisResult = {
  collocations: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  contextualMeaningZh: "调查",
  partOfSpeech: "noun",
  selectionKind: "word",
  similarTerms: [
    { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
    { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
  ],
  sourceText: "investigation",
  type: "translate-lexical",
};

class FakeProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];
  result: ProcessRunResult;

  constructor(result: ProcessRunResult) {
    this.result = result;
  }

  async run(processRequest: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(processRequest);
    return this.result;
  }
}

function successfulRunner(result: unknown = validResult): FakeProcessRunner {
  return new FakeProcessRunner({
    exitCode: 0,
    signal: null,
    stderr: "progress belongs on stderr",
    stdout: JSON.stringify(result),
  });
}

function createProvider(processRunner: ProcessRunner): CodexCliProvider {
  return new CodexCliProvider({
    codexExecutable: "/opt/homebrew/bin/codex",
    environment: {
      HOME: "/Users/tester",
      OPENAI_API_KEY: "must-not-leak",
      PATH: "/usr/bin:/bin",
    },
    processRunner,
    schemaDirectory: "/Applications/Huayi/schemas",
    workingDirectory: "/tmp/huayi-empty",
  });
}

describe("CodexCliProvider", () => {
  it("invokes an ephemeral isolated Codex process through stdin and validates JSON", async () => {
    const runner = successfulRunner();
    const provider = createProvider(runner);
    const controller = new AbortController();

    await expect(provider.analyze(request, controller.signal)).resolves.toEqual(validResult);

    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]).toEqual({
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
        "/Applications/Huayi/schemas/translate-lexical.json",
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
        "/tmp/huayi-empty",
        "-",
      ],
      cwd: "/tmp/huayi-empty",
      env: { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
      executable: "/opt/homebrew/bin/codex",
      input: expect.stringContaining('"selection":"investigation"'),
      signal: controller.signal,
      timeoutMs: 60_000,
    });
  });

  it.each([
    ["translate", "word", "translate-lexical.json"],
    ["translate", "phrase", "translate-lexical.json"],
    ["translate", "sentence", "translate-passage.json"],
    ["translate", "paragraph", "translate-passage.json"],
    ["explain", "word", "explain-lexical.json"],
    ["explain", "phrase", "explain-lexical.json"],
    ["explain", "sentence", "explain-sentence.json"],
  ] as const)("maps %s %s to %s", (action, selectionKind, filename) => {
    expect(outputSchemaFilenameFor({ ...request, action, selectionKind })).toBe(filename);
  });

  it("rejects valid protocol JSON that does not correspond to the request", async () => {
    const provider = createProvider(
      successfulRunner({ ...validResult, selectionKind: "phrase", sourceText: "other text" }),
    );

    await expect(provider.analyze(request, new AbortController().signal)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects stdout contamination instead of extracting a JSON substring", async () => {
    const runner = successfulRunner();
    runner.result.stdout = `debug output\n${runner.result.stdout}`;

    await expect(
      createProvider(runner).analyze(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("maps failed Codex exits without returning stderr to the extension", async () => {
    const runner = new FakeProcessRunner({
      exitCode: 1,
      signal: null,
      stderr: "429 request rate limit; /Users/tester/.codex/auth.json",
      stdout: "",
    });

    await expect(
      createProvider(runner).analyze(request, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: expect.not.stringContaining("auth.json"),
      retryable: true,
    });
  });
});
