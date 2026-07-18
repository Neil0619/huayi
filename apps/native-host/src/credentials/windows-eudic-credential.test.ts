import { describe, expect, it, vi } from "vitest";

import type { ProcessRunner } from "../runtime/codex-process.js";
import { WindowsEudicAuthorizationReader } from "./windows-eudic-credential.js";

function createReader(run: ProcessRunner["run"]): WindowsEudicAuthorizationReader {
  return new WindowsEudicAuthorizationReader({
    credentialHelperPath: "C:\\Huayi\\eudic-credential.ps1",
    credentialPath: "C:\\Huayi\\eudic-credential.xml",
    environment: { SystemRoot: "C:\\Windows", TEMP: "C:\\Temp", USERPROFILE: "C:\\Users\\Tester" },
    powershellExecutable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    processRunner: { run },
    workingDirectory: "C:\\Huayi\\workdir",
  });
}

describe("WindowsEudicAuthorizationReader", () => {
  it("reads a DPAPI-protected authorization through the fixed PowerShell helper", async () => {
    const run = vi.fn<ProcessRunner["run"]>(async () => ({
      exitCode: 0,
      signal: null,
      stderr: "",
      stdout: "Bearer secret-authorization",
    }));

    await expect(createReader(run).read(new AbortController().signal)).resolves.toBe(
      "Bearer secret-authorization",
    );
    expect(run).toHaveBeenCalledWith({
      arguments: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\Huayi\\eudic-credential.ps1",
        "read",
        "C:\\Huayi\\eudic-credential.xml",
      ],
      cwd: "C:\\Huayi\\workdir",
      env: {
        SystemRoot: "C:\\Windows",
        TEMP: "C:\\Temp",
        USERPROFILE: "C:\\Users\\Tester",
      },
      executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      input: "",
      maximumOutputBytes: 8192,
      signal: expect.any(AbortSignal),
      timeoutMs: 5000,
    });
  });

  it("maps a missing credential to the existing safe wordbook error", async () => {
    const run = vi.fn<ProcessRunner["run"]>(async () => ({
      exitCode: 3,
      signal: null,
      stderr: "sensitive helper details",
      stdout: "",
    }));

    await expect(createReader(run).read(new AbortController().signal)).rejects.toMatchObject({
      code: "EUDIC_NOT_CONFIGURED",
    });
  });
});
