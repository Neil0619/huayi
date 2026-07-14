import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OPENAI_KEYCHAIN_ACCOUNT,
  OPENAI_KEYCHAIN_LABEL,
  OPENAI_KEYCHAIN_SERVICE,
} from "../credentials/openai-keychain.js";
import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "../runtime/codex-process.js";
import {
  configureOpenAIApiKey,
  removeOpenAIApiKey,
  type InteractiveProcessRequest,
  type InteractiveProcessRunner,
} from "./openai-keychain.js";

const SENTINEL_PREFIX = "test-openai-key-prefix";
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
  const directory = await mkdtemp(join(tmpdir(), "huayi-openai-security-test-"));
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

describe("configureOpenAIApiKey", () => {
  it("supports dry-run without spawning or receiving a credential", async () => {
    const securityExecutable = await createSecurityExecutable();
    const interactiveProcessRunner: InteractiveProcessRunner = { run: vi.fn() };

    const result = await configureOpenAIApiKey({
      dryRun: true,
      environment: { HOME: "/Users/tester" },
      homeDirectory: "/Users/tester",
      interactiveProcessRunner,
      securityExecutable,
    });

    expect(result.dryRun).toBe(true);
    expect(result.actions).toHaveLength(1);
    expect(interactiveProcessRunner.run).not.toHaveBeenCalled();
  });

  it("uses the exact item, hidden input, shell false, -U, no -A, and a final -w", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: InteractiveProcessRequest[] = [];
    const interactiveProcessRunner: InteractiveProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return { exitCode: 0, signal: null };
      },
    };

    await configureOpenAIApiKey({
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
          OPENAI_KEYCHAIN_SERVICE,
          "-a",
          OPENAI_KEYCHAIN_ACCOUNT,
          "-l",
          OPENAI_KEYCHAIN_LABEL,
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
  });

  it("fails safely when the Keychain update does not succeed", async () => {
    const securityExecutable = await createSecurityExecutable();
    const interactiveProcessRunner: InteractiveProcessRunner = {
      run: async () => ({ exitCode: 1, signal: null }),
    };

    const error = await configureOpenAIApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      interactiveProcessRunner,
      securityExecutable,
    }).catch((caught) => caught);

    expect(String(error)).toMatch(/Keychain/i);
    expectNoSentinel(error);
  });

  it("sanitizes interactive runner errors", async () => {
    const securityExecutable = await createSecurityExecutable();
    const interactiveProcessRunner: InteractiveProcessRunner = {
      run: vi.fn().mockRejectedValue(new Error(`interactive failure ${SENTINEL_API_KEY}`)),
    };

    const error = await configureOpenAIApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      interactiveProcessRunner,
      securityExecutable,
    }).catch((caught) => caught);

    expectNoSentinel(error);
    expect(String(error)).toMatch(/Keychain/i);
  });
});

describe("removeOpenAIApiKey", () => {
  it("dry-run queries the exact item without reading or deleting its value", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return processResult();
      },
    };

    const result = await removeOpenAIApiKey({
      dryRun: true,
      environment: { HOME: "/Users/tester" },
      homeDirectory: "/Users/tester",
      processRunner,
      securityExecutable,
    });

    expect(result.actions).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.arguments).toEqual([
      "find-generic-password",
      "-s",
      OPENAI_KEYCHAIN_SERVICE,
      "-a",
      OPENAI_KEYCHAIN_ACCOUNT,
    ]);
    expect(requests[0]?.arguments).not.toContain("-w");
  });

  it("queries and deletes only the exact service and account", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return processResult();
      },
    };

    await removeOpenAIApiKey({
      dryRun: false,
      environment: { HOME: "/Users/tester" },
      homeDirectory: "/Users/tester",
      processRunner,
      securityExecutable,
    });

    expect(requests.map((request) => request.arguments)).toEqual([
      ["find-generic-password", "-s", OPENAI_KEYCHAIN_SERVICE, "-a", OPENAI_KEYCHAIN_ACCOUNT],
      ["delete-generic-password", "-s", OPENAI_KEYCHAIN_SERVICE, "-a", OPENAI_KEYCHAIN_ACCOUNT],
    ]);
  });

  it("is idempotent when the item is missing before or during deletion", async () => {
    const securityExecutable = await createSecurityExecutable();
    const initiallyMissing = await removeOpenAIApiKey({
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
    const removedDuringDeletion = await removeOpenAIApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner: { run },
      securityExecutable,
    });

    expect(initiallyMissing.actions).toEqual([]);
    expect(removedDuringDeletion.actions).toEqual([]);
  });

  it("does not expose captured process diagnostics when removal fails", async () => {
    const securityExecutable = await createSecurityExecutable();
    const processRunner: ProcessRunner = {
      run: async () =>
        processResult({
          exitCode: 1,
          stderr: `locked ${SENTINEL_API_KEY}`,
          stdout: SENTINEL_API_KEY,
        }),
    };

    const error = await removeOpenAIApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner,
      securityExecutable,
    }).catch((caught) => caught);

    expect(String(error)).toMatch(/Keychain/i);
    expectNoSentinel(error);
  });

  it("sanitizes captured runner errors during query and deletion", async () => {
    const securityExecutable = await createSecurityExecutable();
    const queryError = await removeOpenAIApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner: {
        run: vi.fn().mockRejectedValue(new Error(`query failure ${SENTINEL_API_KEY}`)),
      },
      securityExecutable,
    }).catch((caught) => caught);
    const run = vi
      .fn<ProcessRunner["run"]>()
      .mockResolvedValueOnce(processResult())
      .mockRejectedValueOnce(new Error(`deletion failure ${SENTINEL_API_KEY}`));
    const deletionError = await removeOpenAIApiKey({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner: { run },
      securityExecutable,
    }).catch((caught) => caught);

    for (const error of [queryError, deletionError]) {
      expectNoSentinel(error);
      expect(String(error)).toMatch(/Keychain/i);
    }
  });
});
