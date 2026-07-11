import { describe, expect, it } from "vitest";

import {
  NATIVE_HOST_NAME,
  createNativeHostManifest,
  validateExtensionId,
} from "./native-manifest.js";

const validExtensionId = "abcdefghijklmnopabcdefghijklmnop";

describe("validateExtensionId", () => {
  it("accepts an unpacked Chrome extension ID", () => {
    expect(() => validateExtensionId(validExtensionId)).not.toThrow();
  });

  it.each([
    ["31 characters", "abcdefghijklmnopabcdefghijklmno"],
    ["33 characters", "abcdefghijklmnopabcdefghijklmnopa"],
    ["uppercase characters", "Abcdefghijklmnopabcdefghijklmnop"],
    ["characters after p", "qbcdefghijklmnopabcdefghijklmnop"],
    ["digits", "1bcdefghijklmnopabcdefghijklmnop"],
    ["surrounding whitespace", ` ${validExtensionId}`],
  ])("rejects %s", (_description, extensionId) => {
    expect(() => validateExtensionId(extensionId)).toThrow(/extension ID/i);
  });
});

describe("createNativeHostManifest", () => {
  it("creates the strict Chrome native host manifest", () => {
    const launcherPath =
      "/Users/tester/Library/Application Support/Huayi/native-host/huayi-native-host";

    expect(createNativeHostManifest(validExtensionId, launcherPath)).toEqual({
      allowed_origins: [`chrome-extension://${validExtensionId}/`],
      description: "Huayi Codex Native Messaging bridge",
      name: NATIVE_HOST_NAME,
      path: launcherPath,
      type: "stdio",
    });
    expect(NATIVE_HOST_NAME).toBe("com.huayi.codex_bridge");
  });

  it("rejects an invalid extension ID", () => {
    expect(() => createNativeHostManifest("invalid", "/Applications/Huayi/host")).toThrow(
      /extension ID/i,
    );
  });

  it("rejects a relative launcher path", () => {
    expect(() => createNativeHostManifest(validExtensionId, "huayi-native-host")).toThrow(
      /absolute/i,
    );
  });
});
