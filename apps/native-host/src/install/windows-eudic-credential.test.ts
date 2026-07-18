import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureWindowsEudicCredential,
  removeWindowsEudicCredential,
} from "./windows-eudic-credential.js";

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
  const workingDirectory = await mkdtemp(join(tmpdir(), "huayi-windows-eudic-"));
  temporaryDirectories.push(workingDirectory);
  const credentialHelperPath = join(workingDirectory, "eudic-credential.ps1");
  const powershellExecutable = join(workingDirectory, "powershell.exe");
  await writeFile(credentialHelperPath, "# helper", "utf8");
  await writeFile(powershellExecutable, "fake powershell", "utf8");
  return {
    credentialHelperPath,
    credentialPath: join(workingDirectory, "eudic-credential.xml"),
    powershellExecutable,
    workingDirectory,
  };
}

describe("Windows Eudic credential operations", () => {
  it("configures through an interactive fixed helper invocation", async () => {
    const paths = await fixturePaths();
    const run = vi.fn(async () => ({ exitCode: 0, signal: null }));

    await expect(
      configureWindowsEudicCredential({
        ...paths,
        dryRun: false,
        environment: { SystemRoot: "C:\\Windows" },
        interactiveProcessRunner: { run },
      }),
    ).resolves.toMatchObject({ dryRun: false });

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

  it("removes only the fixed Eudic credential path", async () => {
    const paths = await fixturePaths();
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stderr: "",
      stdout: "",
    }));

    await expect(
      removeWindowsEudicCredential({
        ...paths,
        dryRun: false,
        environment: { SystemRoot: "C:\\Windows" },
        processRunner: { run },
      }),
    ).resolves.toMatchObject({ dryRun: false });

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
});
