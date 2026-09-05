import { afterEach, describe, expect, it, vi } from "vitest";

import { extensionSessionHeaders } from "./extension-session-headers.js";

afterEach(() => vi.unstubAllGlobals());

describe("Cloud Extension session headers", () => {
  it("derives Origin from the extension runtime for authenticated GET requests", () => {
    const origin = `chrome-extension://${"a".repeat(32)}`;
    vi.stubGlobal("location", { origin });
    expect(extensionSessionHeaders("s".repeat(43), "1.0.0")).toMatchObject({ Origin: origin });
  });

  it.each(["https://attacker.invalid", "null", "chrome-extension://not-an-id", undefined])(
    "does not invent extension authority from %s",
    (origin) => {
      vi.stubGlobal("location", { origin });
      expect(extensionSessionHeaders("s".repeat(43), "1.0.0")).not.toHaveProperty("Origin");
    },
  );
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
