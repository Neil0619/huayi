import { describe, expect, it, vi } from "vitest";

import type { ProcessRunRequest, ProcessRunResult, ProcessRunner } from "./codex-process.js";
import { checkCodexCapabilities } from "./codex-capabilities.js";

const REQUIRED_HELP = [
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  "--disable",
  "--sandbox",
  "--skip-git-repo-check",
  "--output-schema",
  "--color",
  "--cd",
  "--config",
].join("\n");

const DISABLED_FEATURES = [
  "shell_tool stable false",
  "unified_exec stable false",
  "shell_snapshot stable false",
].join("\n");

class FakeProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];
  private readonly results: ProcessRunResult[];

  constructor(results: ProcessRunResult[]) {
    this.results = [...results];
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error("Missing fake process result.");
    }
    return result;
  }
}

function result(stdout: string, exitCode = 0, stderr = ""): ProcessRunResult {
  return { exitCode, signal: null, stderr, stdout };
}

describe("checkCodexCapabilities", () => {
  it("checks version, required exec flags, and ChatGPT login without a model request", async () => {
    const runner = new FakeProcessRunner([
      result("codex-cli 0.144.1\n"),
      result(REQUIRED_HELP),
      result(DISABLED_FEATURES),
      result("Logged in using ChatGPT\n"),
    ]);

    await expect(
      checkCodexCapabilities({
        codexExecutable: "/opt/homebrew/bin/codex",
        environment: { HOME: "/Users/tester", PATH: "/usr/bin" },
        processRunner: runner,
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).resolves.toEqual({ codexVersion: "codex-cli 0.144.1" });

    expect(runner.requests.map((request) => request.arguments)).toEqual([
      ["--version"],
      ["exec", "--help"],
      [
        "features",
        "list",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
        "--disable",
        "shell_snapshot",
      ],
      ["login", "status"],
    ]);
    expect(runner.requests.every((request) => request.input === "")).toBe(true);
    expect(runner.requests.every((request) => request.timeoutMs === 10_000)).toBe(true);
  });

  it("fails closed when a required exec capability is absent", async () => {
    const runner = new FakeProcessRunner([
      result("codex-cli 0.144.1"),
      result(REQUIRED_HELP.replace("--ephemeral", "")),
    ]);

    await expect(
      checkCodexCapabilities({
        codexExecutable: "codex",
        environment: {},
        processRunner: runner,
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING", retryable: false });
  });

  it("reports an unauthenticated CLI without exposing its diagnostics", async () => {
    const runner = new FakeProcessRunner([
      result("codex-cli 0.144.1"),
      result(REQUIRED_HELP),
      result(DISABLED_FEATURES),
      result("", 1, "/Users/tester/.codex/auth.json is unavailable"),
    ]);

    await expect(
      checkCodexCapabilities({
        codexExecutable: "codex",
        environment: {},
        processRunner: runner,
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).rejects.toMatchObject({
      code: "CODEX_NOT_AUTHENTICATED",
      message: expect.not.stringContaining("auth.json"),
    });
  });

  it("fails closed when shell-related features cannot all be disabled", async () => {
    const runner = new FakeProcessRunner([
      result("codex-cli 0.144.1"),
      result(REQUIRED_HELP),
      result(DISABLED_FEATURES.replace("shell_tool stable false", "shell_tool stable true")),
    ]);

    await expect(
      checkCodexCapabilities({
        codexExecutable: "codex",
        environment: {},
        processRunner: runner,
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
  });

  it("maps runner launch failures to a missing capability", async () => {
    const processRunner: ProcessRunner = {
      run: vi.fn().mockRejectedValue(new Error("ENOENT /secret/path")),
    };

    await expect(
      checkCodexCapabilities({
        codexExecutable: "codex",
        environment: {},
        processRunner,
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
  });
});
