import { describe, expect, it } from "vitest";

import { readNativeHostConfiguration } from "./native-host-configuration.js";

describe("Windows DeepSeek-only native host configuration", () => {
  it("does not require a Codex executable or provider configuration", () => {
    expect(
      readNativeHostConfiguration({
        HUAYI_DEEPSEEK_CREDENTIAL_HELPER_PATH: "C:\\Huayi\\deepseek-credential.ps1",
        HUAYI_DEEPSEEK_CREDENTIAL_PATH: "C:\\Huayi\\deepseek-credential.xml",
        HUAYI_PLATFORM_MODE: "windows-deepseek",
        HUAYI_POWERSHELL_PATH: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        HUAYI_SCHEMA_DIR: "C:\\Huayi\\provider\\schemas",
        HUAYI_WORK_DIR: "C:\\Huayi\\workdir",
      }),
    ).toMatchObject({
      codexExecutable: null,
      platformMode: "windows-deepseek",
      providerConfigurationPath: null,
    });
  });

  it("requires all installer-owned Windows credential paths", () => {
    expect(() =>
      readNativeHostConfiguration({
        HUAYI_PLATFORM_MODE: "windows-deepseek",
        HUAYI_SCHEMA_DIR: "C:\\Huayi\\provider\\schemas",
        HUAYI_WORK_DIR: "C:\\Huayi\\workdir",
      }),
    ).toThrow(/HUAYI_DEEPSEEK_CREDENTIAL/);
  });
});
