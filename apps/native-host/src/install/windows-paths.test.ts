import { describe, expect, it } from "vitest";

import { createWindowsInstallationPaths } from "./windows-paths.js";

describe("createWindowsInstallationPaths", () => {
  it("keeps every owned Windows artifact below LOCALAPPDATA", () => {
    const paths = createWindowsInstallationPaths("C:\\Users\\Tester\\AppData\\Local");

    expect(paths).toEqual({
      applicationDirectory: "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host",
      credentialHelperPath:
        "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host\\deepseek-credential.ps1",
      credentialPath:
        "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host\\deepseek-credential.xml",
      executablePath:
        "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host\\huayi-native-host.exe",
      nativeManifestPath:
        "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host\\com.huayi.codex_bridge.json",
      ownershipMarkerPath: "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host\\.huayi-owned",
      schemaDirectory: "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host\\provider\\schemas",
      workingDirectory: "C:\\Users\\Tester\\AppData\\Local\\Huayi\\native-host\\workdir",
    });
  });

  it("rejects missing and relative LOCALAPPDATA paths", () => {
    expect(() => createWindowsInstallationPaths("")).toThrow(/LOCALAPPDATA/);
    expect(() => createWindowsInstallationPaths("AppData\\Local")).toThrow(/absolute/);
  });
});
