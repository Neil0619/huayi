import { describe, expect, it } from "vitest";

import { extensionSessionHeaders } from "./extension-session-headers.js";

describe("Cloud Extension session headers", () => {
  it("builds the only authenticated business headers from strict public inputs", () => {
    expect(extensionSessionHeaders("s".repeat(43), "1.0.0")).toEqual({
      Authorization: `HuayiExtension ${"s".repeat(43)}`,
      "X-Huayi-Client-Version": "1.0.0",
    });
    expect(() => extensionSessionHeaders("short", "1.0.0")).toThrow();
    expect(() => extensionSessionHeaders(`${"s".repeat(42)} `, "1.0.0")).toThrow();
    expect(() => extensionSessionHeaders("s".repeat(43), "1.0")).toThrow();
    expect(() => extensionSessionHeaders("s".repeat(43), "01.0.0")).toThrow();
    expect(() => extensionSessionHeaders("s".repeat(43), "9007199254740992.0.0")).toThrow();
  });
});
