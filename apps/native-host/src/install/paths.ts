import { posix } from "node:path";

import { NATIVE_HOST_NAME } from "./native-manifest.js";

export interface MacosInstallationPaths {
  readonly applicationDirectory: string;
  readonly bundlePath: string;
  readonly compatibleHttpConfigurationPath: string;
  readonly launcherPath: string;
  readonly nativeManifestPath: string;
  readonly ownershipMarkerPath: string;
  readonly providerConfigurationPath: string;
  readonly schemaDirectory: string;
  readonly workingDirectory: string;
}

export function createMacosInstallationPaths(homeDirectory: string): MacosInstallationPaths {
  if (!posix.isAbsolute(homeDirectory)) {
    throw new TypeError("macOS home directory must be an absolute path.");
  }

  const applicationDirectory = posix.join(
    homeDirectory,
    "Library/Application Support/Huayi/native-host",
  );

  return {
    applicationDirectory,
    bundlePath: posix.join(applicationDirectory, "main.js"),
    compatibleHttpConfigurationPath: posix.join(applicationDirectory, "compatible-http.json"),
    launcherPath: posix.join(applicationDirectory, "huayi-native-host"),
    nativeManifestPath: posix.join(
      homeDirectory,
      "Library/Application Support/Google/Chrome/NativeMessagingHosts",
      `${NATIVE_HOST_NAME}.json`,
    ),
    ownershipMarkerPath: posix.join(applicationDirectory, ".huayi-owned"),
    providerConfigurationPath: posix.join(applicationDirectory, "provider.json"),
    schemaDirectory: posix.join(applicationDirectory, "provider/schemas"),
    workingDirectory: posix.join(applicationDirectory, "workdir"),
  };
}
