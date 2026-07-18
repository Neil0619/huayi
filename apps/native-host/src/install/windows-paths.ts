import { win32 } from "node:path";

import { NATIVE_HOST_NAME } from "./native-manifest.js";

export interface WindowsInstallationPaths {
  readonly applicationDirectory: string;
  readonly credentialHelperPath: string;
  readonly credentialPath: string;
  readonly executablePath: string;
  readonly nativeManifestPath: string;
  readonly ownershipMarkerPath: string;
  readonly schemaDirectory: string;
  readonly workingDirectory: string;
}

export function createWindowsInstallationPaths(
  localAppDataDirectory: string,
): WindowsInstallationPaths {
  if (localAppDataDirectory.trim().length === 0) {
    throw new TypeError("Windows LOCALAPPDATA is required.");
  }
  if (!win32.isAbsolute(localAppDataDirectory)) {
    throw new TypeError("Windows LOCALAPPDATA must be an absolute path.");
  }

  const applicationDirectory = win32.join(localAppDataDirectory, "Huayi", "native-host");
  return {
    applicationDirectory,
    credentialHelperPath: win32.join(applicationDirectory, "deepseek-credential.ps1"),
    credentialPath: win32.join(applicationDirectory, "deepseek-credential.xml"),
    executablePath: win32.join(applicationDirectory, "huayi-native-host.exe"),
    nativeManifestPath: win32.join(applicationDirectory, `${NATIVE_HOST_NAME}.json`),
    ownershipMarkerPath: win32.join(applicationDirectory, ".huayi-owned"),
    schemaDirectory: win32.join(applicationDirectory, "provider", "schemas"),
    workingDirectory: win32.join(applicationDirectory, "workdir"),
  };
}
