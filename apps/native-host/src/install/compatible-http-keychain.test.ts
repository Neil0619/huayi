import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
  COMPATIBLE_HTTP_KEYCHAIN_LABEL,
  COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
} from "../credentials/compatible-http-keychain.js";
import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "../runtime/codex-process.js";
import {
  configureCompatibleHttpApiKey,
  removeCompatibleHttpApiKey,
  type InteractiveProcessRequest,
  type InteractiveProcessRunner,
} from "./compatible-http-keychain.js";

const SENTINEL_PREFIX = "test-compatible-key-prefix";
const SENTINEL_API_KEY = `${SENTINEL_PREFIX}-sentinel`;
const temporaryDirectories: string[] = [];

function expectNoSentinel(value: unknown): void {
  const text = String(value);
  expect({
    containsKey: text.includes(SENTINEL_API_KEY),
    containsPrefix: text.includes(SENTINEL_PREFIX),
  }).toEqual({ containsKey: false, containsPrefix: false });
}

async function createSecurityExecutable(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-compatible-security-test-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "security");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(executable, 0o755);
  return executable;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function processResult(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return { exitCode: 0, signal: null, stderr: "", stdout: "", ...overrides };
}

describe("configureCompatibleHttpApiKey", () => {
  it("supports dry-run without prompting for or receiving a key", async () => {
    const securityExecutable = await createSecurityExecutable();
    const interactiveProcessRunner: InteractiveProcessRunner = { run: vi.fn() };

    const result = await configureCompatibleHttpApiKey({
      dryRun: true,
      environment: { HOME: "/Users/tester" },
      homeDirectory: "/Users/tester",
      interactiveProcessRunner,
      securityExecutable,
    });

    expect(result.dryRun).toBe(true);
    expect(result.actions).toEqual([
      "Configure macOS Keychain item com.huayi.codex_bridge.compatible_http/api-key",
    ]);
    expect(interactiveProcessRunner.run).not.toHaveBeenCalled();
  });

  it("uses the exact dedicated item, hidden input, shell false, -U, no -A, and final -w", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: InteractiveProcessRequest[] = [];
    const interactiveProcessRunner: InteractiveProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return { exitCode: 0, signal: null };
      },
    };

    await configureCompatibleHttpApiKey({
      dryRun: false,
      environment: { HOME: "/Users/tester", SECRET: "must-not-leak" },
      homeDirectory: "/Users/tester",
      interactiveProcessRunner,
      securityExecutable,
    });

    expect(requests).toEqual([
      {
        arguments: [
          "add-generic-password",
          "-U",
          "-s",
          "com.huayi.codex_bridge.compatible_http",
          "-a",
          "api-key",
          "-l",
          "Huayi OpenAI-Compatible HTTP API Key",
          "-w",
        ],
        cwd: "/Users/tester",
        env: { HOME: "/Users/tester", SECRET: "must-not-leak" },
        executable: securityExecutable,
        shell: false,
      },
    ]);
    expect(requests[0]?.arguments.at(-1)).toBe("-w");
    expect(requests[0]?.arguments).not.toContain("-A");
    expectNoSentinel(requests[0]?.arguments.join(" "));
    expect(COMPATIBLE_HTTP_KEYCHAIN_SERVICE).toBe("com.huayi.codex_bridge.compatible_http");
    expect(COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT).toBe("api-key");
    expect(COMPATIBLE_HTTP_KEYCHAIN_LABEL).toBe("Huayi OpenAI-Compatible HTTP API Key");
  });

  it("maps interactive failures to a fixed safe error", async () => {
    const securityExecutable = await createSecurityExecutable();
    const interactiveProcessRunner: InteractiveProcessRunner = {
      run: vi.fn().mockRejectedValue(new Error(`runner failure ${SENTINEL_API_KEY}`)),
    };

    const error = await configureCompatibleHttpApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      interactiveProcessRunner,
      securityExecutable,
    }).catch((caught) => caught);

    expect(String(error)).toMatch(/compatible.*Keychain/i);
    expectNoSentinel(error);
  });
});

describe("removeCompatibleHttpApiKey", () => {
  it("dry-run queries only the exact item without reading or deleting its value", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return processResult();
      },
    };

    const result = await removeCompatibleHttpApiKey({
      dryRun: true,
      environment: { HOME: "/Users/tester" },
      homeDirectory: "/Users/tester",
      processRunner,
      securityExecutable,
    });

    expect(result.actions).toEqual([
      "Remove macOS Keychain item com.huayi.codex_bridge.compatible_http/api-key",
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      arguments: [
        "find-generic-password",
        "-s",
        COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
        "-a",
        COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
      ],
      input: "",
      maximumOutputBytes: 8 * 1024,
      timeoutMs: 5_000,
    });
    expect(requests[0]?.arguments).not.toContain("-w");
  });

  it("queries and deletes only the dedicated compatible item", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return processResult();
      },
    };

    await removeCompatibleHttpApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner,
      securityExecutable,
    });

    expect(requests.map((request) => request.arguments)).toEqual([
      ["find-generic-password", "-s", "com.huayi.codex_bridge.compatible_http", "-a", "api-key"],
      ["delete-generic-password", "-s", "com.huayi.codex_bridge.compatible_http", "-a", "api-key"],
    ]);
    expect(JSON.stringify(requests)).not.toContain("com.huayi.codex_bridge.openai");
    expect(JSON.stringify(requests)).not.toContain("com.huayi.codex_bridge.eudic");
  });

  it("is idempotent when the item is missing before or during deletion", async () => {
    const securityExecutable = await createSecurityExecutable();
    const initiallyMissing = await removeCompatibleHttpApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner: { run: async () => processResult({ exitCode: 44 }) },
      securityExecutable,
    });
    const run = vi
      .fn<ProcessRunner["run"]>()
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(processResult({ exitCode: 44 }));
    const removedDuringDeletion = await removeCompatibleHttpApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner: { run },
      securityExecutable,
    });

    expect(initiallyMissing.actions).toEqual([]);
    expect(removedDuringDeletion.actions).toEqual([]);
  });

  it("maps captured process failures to fixed safe errors", async () => {
    const securityExecutable = await createSecurityExecutable();
    const failures: ProcessRunner["run"][] = [
      async () =>
        processResult({
          exitCode: 1,
          stderr: `locked ${SENTINEL_API_KEY}`,
          stdout: SENTINEL_API_KEY,
        }),
      vi.fn().mockRejectedValue(new Error(`runner failure ${SENTINEL_API_KEY}`)),
    ];

    for (const run of failures) {
      const error = await removeCompatibleHttpApiKey({
        dryRun: false,
        environment: {},
        homeDirectory: "/Users/tester",
        processRunner: { run },
        securityExecutable,
      }).catch((caught) => caught);

      expect(String(error)).toMatch(/compatible.*Keychain/i);
      expectNoSentinel(error);
    }
  });
});
