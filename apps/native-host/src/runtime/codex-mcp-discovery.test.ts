import { describe, expect, it } from "vitest";

import { APP_SERVER_DISABLED_FEATURES } from "./codex-app-server-config.js";
import { discoverEnabledMcpServerNames } from "./codex-mcp-discovery.js";
import {
  ProcessOutputLimitError,
  ProcessSpawnError,
  ProcessTimeoutError,
  type ProcessRunRequest,
  type ProcessRunResult,
  type ProcessRunner,
} from "./codex-process.js";

const FAKE_DIAGNOSTIC = "/Users/tester/private-codex-diagnostic";

class FakeProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];
  private readonly outcome: Error | ProcessRunResult;

  constructor(outcome: Error | ProcessRunResult) {
    this.outcome = outcome;
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

function result(stdout: string, exitCode = 0): ProcessRunResult {
  return { exitCode, signal: null, stderr: FAKE_DIAGNOSTIC, stdout };
}

function options(processRunner: ProcessRunner) {
  return {
    codexExecutable: "/opt/codex",
    environment: { HOME: "/Users/tester", OPENAI_API_KEY: "secret", PATH: "/usr/bin" },
    processRunner,
    workingDirectory: "/tmp/huayi-empty",
  } as const;
}

async function expectCapabilityMissing(
  promise: Promise<readonly string[]>,
  stdout = "",
): Promise<void> {
  let rejection: unknown;
  try {
    await promise;
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toMatchObject({
    code: "CODEX_CAPABILITY_MISSING",
    retryable: false,
  });
  expect(rejection).toBeInstanceOf(Error);
  if (rejection instanceof Error) {
    expect(rejection.message).not.toContain(FAKE_DIAGNOSTIC);
    if (stdout.length > 0) {
      expect(rejection.message).not.toContain(stdout);
    }
  }
}

const invalidResults: readonly (readonly [string, ProcessRunResult])[] = [
  ["nonzero exit", result("[]", 1)],
  ["signal exit", { ...result("[]"), signal: "SIGTERM" as const }],
  ["invalid JSON", result("not-json")],
  ["non-array JSON", result("{}")],
  ["missing enabled", result('[{"name":"node_repl"}]')],
  ["invalid name", result('[{"enabled":true,"name":"bad.name"}]')],
  ["duplicate name", result('[{"enabled":true,"name":"same"},{"enabled":false,"name":"same"}]')],
  [
    "too many records",
    result(
      JSON.stringify(
        Array.from({ length: 129 }, (_, index) => ({
          enabled: false,
          name: `server-${index}`,
        })),
      ),
    ),
  ],
];

const runnerFailures: readonly (readonly [string, Error])[] = [
  ["timeout", new ProcessTimeoutError(10_000)],
  ["output limit", new ProcessOutputLimitError("stdout", 64 * 1024)],
  ["spawn", new ProcessSpawnError("/opt/codex", new Error(FAKE_DIAGNOSTIC))],
];

describe("discoverEnabledMcpServerNames", () => {
  it("returns only enabled direct MCP servers and uses the bounded locked-down command", async () => {
    const directServers = [
      { enabled: true, name: "confluence-wiki-mcp", transport: { type: "stdio" } },
      { enabled: false, name: "computer-use", transport: { type: "stdio" } },
      { enabled: true, name: "node_repl", transport: { type: "stdio" } },
    ];
    const runner = new FakeProcessRunner(result(JSON.stringify(directServers)));

    await expect(discoverEnabledMcpServerNames(options(runner))).resolves.toEqual([
      "confluence-wiki-mcp",
      "node_repl",
    ]);

    expect(runner.requests[0]).toMatchObject({
      arguments: [
        "mcp",
        "list",
        "--json",
        ...APP_SERVER_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      ],
      cwd: "/tmp/huayi-empty",
      executable: "/opt/codex",
      input: "",
      maximumOutputBytes: 64 * 1024,
      timeoutMs: 10_000,
    });
    expect(runner.requests[0]?.env).toEqual({ HOME: "/Users/tester", PATH: "/usr/bin" });
  });

  it.each(invalidResults)("fails closed for %s", async (_name, processResult) => {
    const runner = new FakeProcessRunner(processResult);

    await expectCapabilityMissing(
      discoverEnabledMcpServerNames(options(runner)),
      processResult.stdout,
    );
  });

  it.each(runnerFailures)(
    "maps runner %s failures to a public capability error",
    async (_name, error) => {
      const runner = new FakeProcessRunner(error);

      await expectCapabilityMissing(discoverEnabledMcpServerNames(options(runner)));
    },
  );
});
