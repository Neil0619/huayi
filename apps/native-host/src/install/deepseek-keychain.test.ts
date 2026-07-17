import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEEPSEEK_KEYCHAIN_ACCOUNT,
  DEEPSEEK_KEYCHAIN_LABEL,
  DEEPSEEK_KEYCHAIN_SERVICE,
} from "../credentials/deepseek-keychain.js";
import type { ProcessRunner } from "../runtime/codex-process.js";
import {
  configureDeepSeekApiKey,
  removeDeepSeekApiKey,
  type DeepSeekCredentialCliOperations,
} from "./deepseek-keychain.js";

const temporaryDirectories: string[] = [];

async function securityExecutable(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-deepseek-keychain-test-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, "security");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(executable, 0o755);
  return executable;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("DeepSeek Keychain lifecycle", () => {
  it("configures the exact dedicated item with hidden input and no shell", async () => {
    const executable = await securityExecutable();
    const run = vi.fn(async () => ({ exitCode: 0, signal: null }));
    const operations: DeepSeekCredentialCliOperations = {
      configureDeepSeek: configureDeepSeekApiKey,
      removeDeepSeek: removeDeepSeekApiKey,
    };

    await operations.configureDeepSeek({
      dryRun: false,
      environment: { HOME: "/Users/tester" },
      homeDirectory: "/Users/tester",
      interactiveProcessRunner: { run },
      securityExecutable: executable,
    });

    expect(run).toHaveBeenCalledWith({
      arguments: [
        "add-generic-password",
        "-U",
        "-s",
        DEEPSEEK_KEYCHAIN_SERVICE,
        "-a",
        DEEPSEEK_KEYCHAIN_ACCOUNT,
        "-l",
        DEEPSEEK_KEYCHAIN_LABEL,
        "-w",
      ],
      cwd: "/Users/tester",
      env: { HOME: "/Users/tester" },
      executable,
      shell: false,
    });
  });

  it("removes only the exact item and remains idempotent when missing", async () => {
    const executable = await securityExecutable();
    const run = vi.fn<ProcessRunner["run"]>(async () => ({
      exitCode: 44,
      signal: null,
      stderr: "",
      stdout: "",
    }));

    await expect(
      removeDeepSeekApiKey({
        dryRun: false,
        environment: {},
        homeDirectory: "/Users/tester",
        processRunner: { run },
        securityExecutable: executable,
      }),
    ).resolves.toMatchObject({ actions: [] });
    expect(run.mock.calls[0]?.[0].arguments).toEqual([
      "find-generic-password",
      "-s",
      DEEPSEEK_KEYCHAIN_SERVICE,
      "-a",
      DEEPSEEK_KEYCHAIN_ACCOUNT,
    ]);
    expect(run.mock.calls[0]?.[0].arguments).not.toContain("-w");
  });
});
