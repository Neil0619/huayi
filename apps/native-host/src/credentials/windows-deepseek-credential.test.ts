import { describe, expect, it, vi } from "vitest";

import type { ProcessRunner } from "../runtime/codex-process.js";
import { DeepSeekCredentialError } from "./deepseek-keychain.js";
import { WindowsDeepSeekApiKeyReader } from "./windows-deepseek-credential.js";

function createReader(run: ProcessRunner["run"]): WindowsDeepSeekApiKeyReader {
  return new WindowsDeepSeekApiKeyReader({
    credentialHelperPath: "C:\\Huayi\\deepseek-credential.ps1",
    credentialPath: "C:\\Huayi\\deepseek-credential.xml",
    environment: { SystemRoot: "C:\\Windows", TEMP: "C:\\Temp", USERPROFILE: "C:\\Users\\Tester" },
    powershellExecutable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    processRunner: { run },
    workingDirectory: "C:\\Huayi\\workdir",
  });
}

describe("WindowsDeepSeekApiKeyReader", () => {
  it("reads a DPAPI protected credential through the fixed PowerShell helper", async () => {
    const run = vi.fn<ProcessRunner["run"]>(async () => ({
      exitCode: 0,
      signal: null,
      stderr: "",
      stdout: "secret-key",
    }));

    await expect(createReader(run).read(new AbortController().signal)).resolves.toBe("secret-key");
    expect(run).toHaveBeenCalledWith({
      arguments: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\Huayi\\deepseek-credential.ps1",
        "read",
        "C:\\Huayi\\deepseek-credential.xml",
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

  it("maps a missing credential without exposing PowerShell output", async () => {
    const run = vi.fn<ProcessRunner["run"]>(async () => ({
      exitCode: 3,
      signal: null,
      stderr: "sensitive helper details",
      stdout: "",
    }));

    await expect(createReader(run).read(new AbortController().signal)).rejects.toEqual(
      new DeepSeekCredentialError("MODEL_PROVIDER_NOT_CONFIGURED"),
    );
  });
});
