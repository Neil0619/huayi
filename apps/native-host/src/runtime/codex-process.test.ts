import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAXIMUM_OUTPUT_BYTES,
  DEFAULT_PROCESS_TIMEOUT_MS,
  NodeProcessRunner,
  ProcessAbortedError,
  ProcessOutputLimitError,
  ProcessSpawnError,
  ProcessTimeoutError,
  buildAllowedEnvironment,
} from "./codex-process.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-process-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("buildAllowedEnvironment", () => {
  it("copies only the documented Codex environment allowlist", () => {
    expect(
      buildAllowedEnvironment({
        ALL_PROXY: "socks5://127.0.0.1:1080",
        CODEX_HOME: "/tmp/codex-home",
        HOME: "/Users/tester",
        HTTPS_PROXY: "https://proxy.example",
        LANG: "en_US.UTF-8",
        NODE_OPTIONS: "--require malicious.js",
        OPENAI_API_KEY: "must-not-leak",
        PATH: "/usr/bin:/bin",
        RANDOM_SECRET: "must-not-leak",
        TMPDIR: "/tmp",
        USER: undefined,
      }),
    ).toEqual({
      ALL_PROXY: "socks5://127.0.0.1:1080",
      CODEX_HOME: "/tmp/codex-home",
      HOME: "/Users/tester",
      HTTPS_PROXY: "https://proxy.example",
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      TMPDIR: "/tmp",
    });
  });
});

describe("NodeProcessRunner", () => {
  it("uses argument arrays and stdin while capturing stdout and stderr", async () => {
    const cwd = await createTemporaryDirectory();
    const runner = new NodeProcessRunner();
    const program = [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  process.stdout.write(JSON.stringify({",
      "    arguments: process.argv.slice(1),",
      "    cwd: process.cwd(),",
      "    input,",
      "    lang: process.env.LANG,",
      "    leaked: process.env.OPENAI_API_KEY,",
      "  }));",
      "  process.stderr.write('diagnostic');",
      "});",
    ].join("\n");

    const result = await runner.run({
      arguments: ["-e", program, "first argument", "$(must-not-expand)"],
      cwd,
      env: {
        LANG: "huayi-test",
        OPENAI_API_KEY: "must-not-leak",
      },
      executable: process.execPath,
      input: "selected webpage text",
    });

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stderr: "diagnostic",
    });
    const output = JSON.parse(result.stdout) as {
      arguments: string[];
      cwd: string;
      input: string;
      lang: string;
    };
    expect(output).toMatchObject({
      arguments: ["first argument", "$(must-not-expand)"],
      input: "selected webpage text",
      lang: "huayi-test",
    });
    expect(await realpath(output.cwd)).toBe(await realpath(cwd));
  });

  it("returns non-zero exits without converting them into spawn errors", async () => {
    const runner = new NodeProcessRunner();

    const result = await runner.run({
      arguments: ["-e", "process.stderr.write('failed'); process.exitCode = 7;"],
      cwd: await createTemporaryDirectory(),
      env: {},
      executable: process.execPath,
      input: "",
    });

    expect(result).toEqual({
      exitCode: 7,
      signal: null,
      stderr: "failed",
      stdout: "",
    });
  });

  it("kills an active process when its AbortSignal is aborted", async () => {
    const controller = new AbortController();
    const runner = new NodeProcessRunner();
    const run = runner.run({
      arguments: ["-e", "setInterval(() => undefined, 1_000);"],
      cwd: await createTemporaryDirectory(),
      env: {},
      executable: process.execPath,
      input: "",
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 25);

    await expect(run).rejects.toBeInstanceOf(ProcessAbortedError);
  });

  it("kills a process that exceeds the configured timeout", async () => {
    const runner = new NodeProcessRunner();

    const run = runner.run({
      arguments: ["-e", "setInterval(() => undefined, 1_000);"],
      cwd: await createTemporaryDirectory(),
      env: {},
      executable: process.execPath,
      input: "",
      timeoutMs: 25,
    });

    await expect(run).rejects.toMatchObject({
      name: ProcessTimeoutError.name,
      timeoutMs: 25,
    });
  });

  it.each(["stdout", "stderr"] as const)(
    "fails closed when %s exceeds the configured byte limit",
    async (stream) => {
      const runner = new NodeProcessRunner();
      const program = `process.${stream}.write('123456789');`;

      const run = runner.run({
        arguments: ["-e", program],
        cwd: await createTemporaryDirectory(),
        env: {},
        executable: process.execPath,
        input: "",
        maximumOutputBytes: 8,
      });

      await expect(run).rejects.toMatchObject({
        maximumOutputBytes: 8,
        name: ProcessOutputLimitError.name,
        stream,
      });
    },
  );

  it("reports executable launch failures as a named spawn error", async () => {
    const runner = new NodeProcessRunner();

    const run = runner.run({
      arguments: [],
      cwd: await createTemporaryDirectory(),
      env: {},
      executable: "/definitely/missing/huayi-command",
      input: "",
    });

    await expect(run).rejects.toBeInstanceOf(ProcessSpawnError);
  });

  it("uses the required safe defaults", () => {
    expect(DEFAULT_PROCESS_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_MAXIMUM_OUTPUT_BYTES).toBe(1024 * 1024);
  });
});
