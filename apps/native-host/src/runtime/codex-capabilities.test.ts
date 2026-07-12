import { describe, expect, it, vi } from "vitest";

import type { ProcessRunRequest, ProcessRunResult, ProcessRunner } from "./codex-process.js";
import { checkCodexCapabilities } from "./codex-capabilities.js";

const REQUIRED_HELP = ["--stdio", "--strict-config", "--disable", "--config"].join("\n");
const DISABLED_FEATURE_NAMES = [
  "apps",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "tool_suggest",
] as const;
const DISABLED_FEATURES = DISABLED_FEATURE_NAMES.map((feature) => `${feature} stable false`).join(
  "\n",
);

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
  it("checks App Server flags, every disabled feature, and ChatGPT login", async () => {
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
      ["app-server", "--help"],
      ["features", "list", ...DISABLED_FEATURE_NAMES.flatMap((feature) => ["--disable", feature])],
      ["login", "status"],
    ]);
    expect(runner.requests.every((request) => request.input === "")).toBe(true);
    expect(runner.requests.every((request) => request.timeoutMs === 10_000)).toBe(true);
  });

  it("fails closed when a required App Server capability is absent", async () => {
    const runner = new FakeProcessRunner([
      result("codex-cli 0.144.1"),
      result(REQUIRED_HELP.replace("--strict-config", "")),
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

  it.each(["Not logged in", "Logged in using API key"])(
    "rejects a non-ChatGPT login status reported with exit zero: %s",
    async (loginStatus) => {
      const runner = new FakeProcessRunner([
        result("codex-cli 0.144.1"),
        result(REQUIRED_HELP),
        result(DISABLED_FEATURES),
        result(loginStatus),
      ]);

      await expect(
        checkCodexCapabilities({
          codexExecutable: "codex",
          environment: {},
          processRunner: runner,
          workingDirectory: "/tmp/huayi-empty",
        }),
      ).rejects.toMatchObject({ code: "CODEX_NOT_AUTHENTICATED" });
    },
  );

  it.each(["apps", "hooks", "image_generation", "mcp-placeholder", "shell_tool"])(
    "fails closed when the disabled feature %s is true or absent",
    async (feature) => {
      const output =
        feature === "mcp-placeholder"
          ? DISABLED_FEATURES.replace("tool_suggest stable false", "")
          : DISABLED_FEATURES.replace(`${feature} stable false`, `${feature} stable true`);
      const runner = new FakeProcessRunner([
        result("codex-cli 0.144.1"),
        result(REQUIRED_HELP),
        result(output),
      ]);

      await expect(
        checkCodexCapabilities({
          codexExecutable: "codex",
          environment: {},
          processRunner: runner,
          workingDirectory: "/tmp/huayi-empty",
        }),
      ).rejects.toMatchObject({ code: "CODEX_CAPABILITY_MISSING" });
    },
  );

  it("does not require exec-only flags", async () => {
    const runner = new FakeProcessRunner([
      result("codex-cli 0.144.1"),
      result(REQUIRED_HELP),
      result(DISABLED_FEATURES),
      result("Logged in using ChatGPT"),
    ]);

    await expect(
      checkCodexCapabilities({
        codexExecutable: "codex",
        environment: {},
        processRunner: runner,
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).resolves.toEqual({ codexVersion: "codex-cli 0.144.1" });
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
