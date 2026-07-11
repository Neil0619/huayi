import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import { NodeProcessRunner } from "../runtime/codex-process.js";
import { CodexCliProvider } from "./codex-cli-provider.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "fake-codex-1",
  schemaVersion: 1,
  selection: "investigation",
  selectionKind: "word",
  targetLanguage: "zh-CN",
  type: "analyze",
};

const result = {
  collocations: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  contextualMeaningZh: "安全的调查结果",
  partOfSpeech: "noun",
  selectionKind: "word",
  similarTerms: [
    { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
    { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
  ],
  sourceText: "investigation",
  type: "translate-lexical",
} as const;

const temporaryDirectories: string[] = [];

async function createFakeCodex(prefix = ""): Promise<{
  executable: string;
  schemaDirectory: string;
  workingDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "huayi-fake-codex-"));
  temporaryDirectories.push(root);
  const executable = join(root, "fake-codex");
  const schemaDirectory = join(root, "schemas");
  const workingDirectory = join(root, "workdir");
  await mkdir(schemaDirectory);
  await mkdir(workingDirectory);
  const program = [
    `#!${process.execPath}`,
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    '  if (!input.includes(\'\\"selection\\":\\"investigation\\"\')) process.exit(2);',
    "  if (process.env.OPENAI_API_KEY) process.exit(3);",
    `  process.stdout.write(${JSON.stringify(prefix)} + ${JSON.stringify(JSON.stringify(result))});`,
    "});",
    "",
  ].join("\n");
  await writeFile(executable, program, "utf8");
  await chmod(executable, 0o755);
  return { executable, schemaDirectory, workingDirectory };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("CodexCliProvider with a fake executable", () => {
  it("uses real spawn/stdin while filtering secrets and validating the result", async () => {
    const fixture = await createFakeCodex();
    const provider = new CodexCliProvider({
      codexExecutable: fixture.executable,
      environment: { OPENAI_API_KEY: "must-not-leak", PATH: process.env.PATH },
      processRunner: new NodeProcessRunner(),
      schemaDirectory: fixture.schemaDirectory,
      workingDirectory: fixture.workingDirectory,
    });

    await expect(provider.analyze(request, new AbortController().signal)).resolves.toEqual(result);
  });

  it("fails closed when the executable contaminates stdout", async () => {
    const fixture = await createFakeCodex("debug output\n");
    const provider = new CodexCliProvider({
      codexExecutable: fixture.executable,
      environment: { PATH: process.env.PATH },
      processRunner: new NodeProcessRunner(),
      schemaDirectory: fixture.schemaDirectory,
      workingDirectory: fixture.workingDirectory,
    });

    await expect(provider.analyze(request, new AbortController().signal)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
