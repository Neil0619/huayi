import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureWindowsDeepSeekCredential,
  removeWindowsDeepSeekCredential,
} from "./windows-deepseek-credential.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function fixturePaths(): Promise<{
  credentialHelperPath: string;
  credentialPath: string;
  powershellExecutable: string;
  workingDirectory: string;
}> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "huayi-windows-deepseek-"));
  temporaryDirectories.push(workingDirectory);
  const credentialHelperPath = join(workingDirectory, "deepseek-credential.ps1");
  const powershellExecutable = join(workingDirectory, "powershell.exe");
  await writeFile(credentialHelperPath, "# helper", "utf8");
  await writeFile(powershellExecutable, "fake powershell", "utf8");
  if (process.platform !== "win32") await chmod(powershellExecutable, 0o755);
  return {
    credentialHelperPath,
    credentialPath: join(workingDirectory, "deepseek-credential.xml"),
    powershellExecutable,
    workingDirectory,
  };
}

describe("Windows DeepSeek credential operations", () => {
  it("configures through an interactive fixed helper invocation", async () => {
    const paths = await fixturePaths();
    const run = vi.fn(async () => ({ exitCode: 0, signal: null }));

    await expect(
      configureWindowsDeepSeekCredential({
        ...paths,
        dryRun: false,
        environment: { SystemRoot: "C:\\Windows" },
        interactiveProcessRunner: { run },
      }),
    ).resolves.toEqual({
      actions: ["Configure Windows DPAPI-protected DeepSeek credential"],
      dryRun: false,
    });

    expect(run).toHaveBeenCalledWith({
      arguments: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        paths.credentialHelperPath,
        "configure",
        paths.credentialPath,
      ],
      cwd: paths.workingDirectory,
      env: { SystemRoot: "C:\\Windows" },
      executable: paths.powershellExecutable,
      shell: false,
    });
  });

  it("removes only the fixed DeepSeek credential path", async () => {
    const paths = await fixturePaths();
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stderr: "",
      stdout: "",
    }));

    await expect(
      removeWindowsDeepSeekCredential({
        ...paths,
        dryRun: false,
        environment: { SystemRoot: "C:\\Windows" },
        processRunner: { run },
      }),
    ).resolves.toEqual({
      actions: ["Remove Windows DPAPI-protected DeepSeek credential"],
      dryRun: false,
    });

    expect(run).toHaveBeenCalledWith({
      arguments: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        paths.credentialHelperPath,
        "remove",
        paths.credentialPath,
      ],
      cwd: paths.workingDirectory,
      env: { SystemRoot: "C:\\Windows" },
      executable: paths.powershellExecutable,
      input: "",
      maximumOutputBytes: 8192,
      timeoutMs: 5000,
    });
  });

  it("validates helpers but never invokes PowerShell for dry-run operations", async () => {
    const paths = await fixturePaths();
    const interactiveRun = vi.fn();
    const run = vi.fn();

    await expect(
      configureWindowsDeepSeekCredential({
        ...paths,
        dryRun: true,
        environment: {},
        interactiveProcessRunner: { run: interactiveRun },
      }),
    ).resolves.toMatchObject({ dryRun: true });
    await expect(
      removeWindowsDeepSeekCredential({
        ...paths,
        dryRun: true,
        environment: {},
        processRunner: { run },
      }),
    ).resolves.toMatchObject({ dryRun: true });

    expect(interactiveRun).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("fails before invocation when PowerShell or the fixed helper is unavailable", async () => {
    const paths = await fixturePaths();
    const run = vi.fn();

    await expect(
      removeWindowsDeepSeekCredential({
        ...paths,
        credentialHelperPath: join(paths.workingDirectory, "missing-helper.ps1"),
        dryRun: false,
        environment: {},
        processRunner: { run },
      }),
    ).rejects.toThrow(/unavailable/i);
    await expect(
      removeWindowsDeepSeekCredential({
        ...paths,
        dryRun: false,
        environment: {},
        powershellExecutable: join(paths.workingDirectory, "missing-powershell.exe"),
        processRunner: { run },
      }),
    ).rejects.toThrow(/unavailable/i);

    expect(run).not.toHaveBeenCalled();
  });

  it.each([[{ exitCode: 1, signal: null }], [{ exitCode: 0, signal: "SIGTERM" as const }]])(
    "maps configure process failure to one safe error",
    async (result) => {
      const paths = await fixturePaths();

      await expect(
        configureWindowsDeepSeekCredential({
          ...paths,
          dryRun: false,
          environment: {},
          interactiveProcessRunner: { run: vi.fn(async () => result) },
        }),
      ).rejects.toThrow("Unable to configure the Windows DeepSeek credential.");
    },
  );

  it.each([
    [{ exitCode: 1, signal: null, stderr: "secret", stdout: "" }],
    [{ exitCode: 0, signal: "SIGTERM" as const, stderr: "", stdout: "" }],
  ])("maps remove process failure to one safe error", async (result) => {
    const paths = await fixturePaths();

    await expect(
      removeWindowsDeepSeekCredential({
        ...paths,
        dryRun: false,
        environment: {},
        processRunner: { run: vi.fn(async () => result) },
      }),
    ).rejects.toThrow("Unable to remove the Windows DeepSeek credential.");
  });
});
