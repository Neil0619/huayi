import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTENSION_SETTINGS,
  evaluatePageAccess,
  normalizeSiteRuleInput,
  parseStoredSettings,
} from "./settings-domain.js";

describe("parseStoredSettings", () => {
  it("uses a complete default configuration when storage is empty", () => {
    expect(parseStoredSettings(undefined)).toEqual({
      settings: DEFAULT_EXTENSION_SETTINGS,
      status: "defaulted",
    });
  });

  it("fills missing fields while rejecting unknown or malformed values", () => {
    expect(parseStoredSettings({ settingsVersion: 1 })).toMatchObject({
      settings: DEFAULT_EXTENSION_SETTINGS,
      status: "valid",
    });
    expect(parseStoredSettings({ enabled: "yes", settingsVersion: 1 }).status).toBe("invalid");
    expect(parseStoredSettings({ settingsVersion: 1, unexpected: true }).status).toBe("invalid");
    expect(
      parseStoredSettings({
        settingsVersion: 1,
        sitePolicy: {
          defaultAction: "allow",
          rules: [
            { action: "block", hostname: "example.com", includeSubdomains: true },
            { action: "allow", hostname: "example.com", includeSubdomains: false },
          ],
        },
      }).status,
    ).toBe("invalid");
    expect(
      parseStoredSettings({
        settingsVersion: 1,
        youtube: {
          shortcut: { alt: false, code: "KeyK", ctrl: true, meta: false, shift: false },
        },
      }),
    ).toMatchObject({
      settings: { youtube: { shortcut: { code: "KeyK", ctrl: true } } },
      status: "valid",
    });
  });
});

describe("normalizeSiteRuleInput", () => {
  it("normalizes URL and IDNA host input without retaining paths or ports", () => {
    expect(normalizeSiteRuleInput("HTTPS://Docs.Example.com:8443/private?q=1")).toBe(
      "docs.example.com",
    );
    expect(normalizeSiteRuleInput("https://例子.测试/path")).toBe("xn--fsqu00a.xn--0zwm56d");
    expect(normalizeSiteRuleInput("example.com.")).toBe("example.com");
  });

  it("rejects credentials, wildcards, non-http URLs, localhost and public suffixes", () => {
    for (const input of [
      "https://user:pass@example.com",
      "*.example.com",
      "ftp://example.com",
      "localhost",
      "com",
      "",
    ]) {
      expect(() => normalizeSiteRuleInput(input)).toThrow();
    }
  });
});

describe("evaluatePageAccess", () => {
  it("uses the most specific matching hostname rule", () => {
    const settings = {
      ...DEFAULT_EXTENSION_SETTINGS,
      sitePolicy: {
        defaultAction: "allow" as const,
        rules: [
          { action: "block" as const, hostname: "example.com", includeSubdomains: true },
          { action: "allow" as const, hostname: "docs.example.com", includeSubdomains: true },
          {
            action: "block" as const,
            hostname: "private.docs.example.com",
            includeSubdomains: false,
          },
        ],
      },
    };

    expect(evaluatePageAccess(new URL("https://www.example.com"), settings)).toBe("block");
    expect(evaluatePageAccess(new URL("https://api.docs.example.com"), settings)).toBe("allow");
    expect(evaluatePageAccess(new URL("https://private.docs.example.com"), settings)).toBe("block");
    expect(evaluatePageAccess(new URL("https://child.private.docs.example.com"), settings)).toBe(
      "allow",
    );
  });

  it("fails closed for invalid settings and non-http pages", () => {
    expect(evaluatePageAccess(new URL("chrome://extensions"), DEFAULT_EXTENSION_SETTINGS)).toBe(
      "block",
    );
    expect(
      evaluatePageAccess(new URL("https://example.com"), {
        ...DEFAULT_EXTENSION_SETTINGS,
        enabled: false,
      }),
    ).toBe("block");
  });
});
