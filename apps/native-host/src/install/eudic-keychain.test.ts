import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EUDIC_KEYCHAIN_ACCOUNT,
  EUDIC_KEYCHAIN_LABEL,
  EUDIC_KEYCHAIN_SERVICE,
} from "../credentials/eudic-keychain.js";
import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "../runtime/codex-process.js";
import {
  configureEudicAuthorization,
  removeEudicAuthorization,
  type InteractiveProcessRequest,
  type InteractiveProcessRunner,
} from "./eudic-keychain.js";

const temporaryDirectories: string[] = [];

async function createSecurityExecutable(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-security-test-"));
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

describe("configureEudicAuthorization", () => {
  it("supports dry-run without prompting for or receiving a credential", async () => {
    const securityExecutable = await createSecurityExecutable();
    const interactiveProcessRunner: InteractiveProcessRunner = { run: vi.fn() };

    const result = await configureEudicAuthorization({
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

  it("uses hidden interactive input, exact identifiers, -U, no -A, and a final -w", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: InteractiveProcessRequest[] = [];
    const interactiveProcessRunner: InteractiveProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return { exitCode: 0, signal: null };
      },
    };

    await configureEudicAuthorization({
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
          EUDIC_KEYCHAIN_SERVICE,
          "-a",
          EUDIC_KEYCHAIN_ACCOUNT,
          "-l",
          EUDIC_KEYCHAIN_LABEL,
          "-w",
        ],
        cwd: "/Users/tester",
        env: { HOME: "/Users/tester", SECRET: "must-not-leak" },
        executable: securityExecutable,
      },
    ]);
    expect(requests[0]?.arguments.at(-1)).toBe("-w");
    expect(requests[0]?.arguments).not.toContain("-A");
    expect(JSON.stringify(requests)).not.toContain("Bearer secret-value");
  });

  it("fails safely when the Keychain update does not succeed", async () => {
    const securityExecutable = await createSecurityExecutable();
    const interactiveProcessRunner: InteractiveProcessRunner = {
      run: async () => ({ exitCode: 1, signal: null }),
    };

    await expect(
      configureEudicAuthorization({
        dryRun: false,
        environment: {},
        homeDirectory: "/Users/tester",
        interactiveProcessRunner,
        securityExecutable,
      }),
    ).rejects.toThrow(/Keychain/i);
  });
});

describe("removeEudicAuthorization", () => {
  it("dry-run queries the exact item without reading or deleting its password", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return processResult();
      },
    };

    const result = await removeEudicAuthorization({
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
      EUDIC_KEYCHAIN_SERVICE,
      "-a",
      EUDIC_KEYCHAIN_ACCOUNT,
    ]);
    expect(requests[0]?.arguments).not.toContain("-w");
  });

  it("deletes only the exact item after confirming that it exists", async () => {
    const securityExecutable = await createSecurityExecutable();
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        return processResult();
      },
    };

    await removeEudicAuthorization({
      dryRun: false,
      environment: { HOME: "/Users/tester" },
      homeDirectory: "/Users/tester",
      processRunner,
      securityExecutable,
    });

    expect(requests.map((request) => request.arguments)).toEqual([
      ["find-generic-password", "-s", EUDIC_KEYCHAIN_SERVICE, "-a", EUDIC_KEYCHAIN_ACCOUNT],
      ["delete-generic-password", "-s", EUDIC_KEYCHAIN_SERVICE, "-a", EUDIC_KEYCHAIN_ACCOUNT],
    ]);
  });

  it("is idempotent when the exact Keychain item is missing", async () => {
    const securityExecutable = await createSecurityExecutable();
    const processRunner: ProcessRunner = {
      run: async () => processResult({ exitCode: 44 }),
    };

    const result = await removeEudicAuthorization({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner,
      securityExecutable,
    });

    expect(result.actions).toEqual([]);
  });

  it("remains idempotent if the item disappears between query and deletion", async () => {
    const securityExecutable = await createSecurityExecutable();
    const run = vi
      .fn<ProcessRunner["run"]>()
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(processResult({ exitCode: 44 }));

    const result = await removeEudicAuthorization({
      dryRun: false,
      environment: {},
      homeDirectory: "/Users/tester",
      processRunner: { run },
      securityExecutable,
    });

    expect(result.actions).toEqual([]);
  });

  it("fails without claiming success when query or deletion fails", async () => {
    const securityExecutable = await createSecurityExecutable();
    const run = vi
      .fn<ProcessRunner["run"]>()
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(processResult({ exitCode: 1, stderr: "secret diagnostics" }));

    await expect(
      removeEudicAuthorization({
        dryRun: false,
        environment: {},
        homeDirectory: "/Users/tester",
        processRunner: { run },
        securityExecutable,
      }),
    ).rejects.toThrow(/Keychain/i);
  });
});
