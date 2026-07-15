import { describe, expect, it } from "vitest";

import { createMacosInstallationPaths } from "./paths.js";

describe("createMacosInstallationPaths", () => {
  it("returns the exact Huayi-owned and Chrome user paths", () => {
    expect(createMacosInstallationPaths("/Users/tester")).toEqual({
      applicationDirectory: "/Users/tester/Library/Application Support/Huayi/native-host",
      bundlePath: "/Users/tester/Library/Application Support/Huayi/native-host/main.js",
      compatibleHttpConfigurationPath:
        "/Users/tester/Library/Application Support/Huayi/native-host/compatible-http.json",
      launcherPath: "/Users/tester/Library/Application Support/Huayi/native-host/huayi-native-host",
      nativeManifestPath:
        "/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.huayi.codex_bridge.json",
      ownershipMarkerPath:
        "/Users/tester/Library/Application Support/Huayi/native-host/.huayi-owned",
      providerConfigurationPath:
        "/Users/tester/Library/Application Support/Huayi/native-host/provider.json",
      schemaDirectory:
        "/Users/tester/Library/Application Support/Huayi/native-host/provider/schemas",
      workingDirectory: "/Users/tester/Library/Application Support/Huayi/native-host/workdir",
    });
  });

  it("rejects a relative home directory", () => {
    expect(() => createMacosInstallationPaths("Users/tester")).toThrow(/absolute/i);
  });
});
