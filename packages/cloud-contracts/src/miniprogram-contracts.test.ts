import { describe, expect, it } from "vitest";

import {
  miniProgramLoginRequestSchema,
  miniProgramLoginResponseSchema,
  miniProgramOnboardingRequestSchema,
  miniProgramPasswordBindingRequestSchema,
} from "./miniprogram-contracts.js";

describe("mini-program contracts", () => {
  it("requires credentials and explicit consent without accepting caller-controlled ownership", () => {
    const input = {
      ticket: "t".repeat(43),
      email: " Friend@Example.com ",
      password: "correct horse battery staple",
      confirmed: true,
    };
    expect(miniProgramPasswordBindingRequestSchema.parse(input).email).toBe("friend@example.com");
    for (const changed of [
      { ...input, confirmed: false },
      { ...input, confirmed: undefined },
      { ...input, userId: "victim" },
      { ...input, mode: "independent" },
      { ...input, ticket: "short" },
      { ...input, password: "" },
    ])
      expect(miniProgramPasswordBindingRequestSchema.safeParse(changed).success).toBe(false);
  });
  it("accepts a code but rejects a caller-supplied identity or quota", () => {
    expect(miniProgramLoginRequestSchema.parse({ code: "one-use-code" })).toEqual({
      code: "one-use-code",
    });
    expect(
      miniProgramLoginRequestSchema.safeParse({ code: "code", userId: "other", quota: 100 })
        .success,
    ).toBe(false);
  });
  it("requires an explicit independent-or-linked onboarding choice", () => {
    const ticket = "t".repeat(43);
    expect(
      miniProgramOnboardingRequestSchema.safeParse({ ticket, mode: "independent" }).success,
    ).toBe(true);
    expect(miniProgramOnboardingRequestSchema.safeParse({ ticket, mode: "merge" }).success).toBe(
      false,
    );
    expect(miniProgramOnboardingRequestSchema.safeParse({ ticket }).success).toBe(false);
  });
  it("never exposes an OpenID or WeChat session key in the login result", () => {
    expect(
      miniProgramLoginResponseSchema.safeParse({
        state: "authenticated",
        token: "t".repeat(43),
        expiresAt: "2026-09-10T00:00:00.000Z",
        openid: "private",
      }).success,
    ).toBe(false);
  });
});
