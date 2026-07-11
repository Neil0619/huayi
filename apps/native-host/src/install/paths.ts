import { isAbsolute, join } from "node:path";

import { NATIVE_HOST_NAME } from "./native-manifest.js";

export interface MacosInstallationPaths {
  readonly applicationDirectory: string;
  readonly bundlePath: string;
  readonly launcherPath: string;
  readonly nativeManifestPath: string;
  readonly ownershipMarkerPath: string;
  readonly schemaDirectory: string;
  readonly workingDirectory: string;
}

export function createMacosInstallationPaths(homeDirectory: string): MacosInstallationPaths {
  if (!isAbsolute(homeDirectory)) {
    throw new TypeError("macOS home directory must be an absolute path.");
  }

  const applicationDirectory = join(homeDirectory, "Library/Application Support/Huayi/native-host");

  return {
    applicationDirectory,
    bundlePath: join(applicationDirectory, "main.js"),
    launcherPath: join(applicationDirectory, "huayi-native-host"),
    nativeManifestPath: join(
      homeDirectory,
      "Library/Application Support/Google/Chrome/NativeMessagingHosts",
      `${NATIVE_HOST_NAME}.json`,
    ),
    ownershipMarkerPath: join(applicationDirectory, ".huayi-owned"),
    schemaDirectory: join(applicationDirectory, "provider/schemas"),
    workingDirectory: join(applicationDirectory, "workdir"),
  };
}
