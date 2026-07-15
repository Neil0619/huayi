import { describe, expect, it } from "vitest";

import { readNativeHostConfiguration } from "./native-host-configuration.js";

describe("readNativeHostConfiguration", () => {
  it("derives sibling Provider paths and ignores compatible path environment input", () => {
    const configuration = readNativeHostConfiguration({
      HUAYI_CODEX_PATH: "/opt/codex",
      HUAYI_COMPATIBLE_HTTP_CONFIGURATION_PATH: "/tmp/untrusted-compatible.json",
      HUAYI_WORK_DIR: "/tmp/huayi/work",
    });

    expect(configuration.compatibleHttpConfigurationPath).toBe("/tmp/huayi/compatible-http.json");
    expect(configuration.providerConfigurationPath).toBe("/tmp/huayi/provider.json");
  });
});
