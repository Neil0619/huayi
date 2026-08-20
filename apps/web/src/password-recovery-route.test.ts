import { describe, expect, it } from "vitest";

import { parsePasswordRecoveryRoute } from "./password-recovery-route.js";

describe("password recovery route", () => {
  it("recognizes only the public recovery path and exact continuation marker", () => {
    expect(parsePasswordRecoveryRoute("/recover", "")).toEqual({
      clearUrl: false,
      continuation: false,
    });
    expect(parsePasswordRecoveryRoute("/recover", "?continue=1")).toEqual({
      clearUrl: true,
      continuation: true,
    });
    expect(parsePasswordRecoveryRoute("/recover", "?continue=1&email=secret@example.com")).toEqual({
      clearUrl: true,
      continuation: false,
    });
    expect(parsePasswordRecoveryRoute("/recover/secret", "")).toBeUndefined();
    expect(parsePasswordRecoveryRoute("/login", "?continue=1")).toBeUndefined();
  });
});
