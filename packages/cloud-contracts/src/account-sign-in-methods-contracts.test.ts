import { describe, expect, it } from "vitest";

import {
  accountSignInMethodsResponseSchema,
  googleLoginStartRequestSchema,
  googleLinkStartRequestSchema,
  googleLinkStartResponseSchema,
  identityHttpRoutes,
  passwordLinkRequestSchema,
  passwordReauthenticationRequestSchema,
  signInMethodSchema,
} from "./account-contracts.js";
import { apiErrorCodeSchema } from "./common-contracts.js";

const linkedAt = "2026-08-14T10:00:00.000Z";

describe("account sign-in methods contract", () => {
  it("owns one strict empty command for ordinary Google login", () => {
    expect(identityHttpRoutes.googleLoginStart).toBe("/v1/auth/google/login/start");
    expect(googleLoginStartRequestSchema.parse({})).toEqual({});
    for (const input of [
      { claimTicket: "private" },
      { email: "learner@example.com" },
      { returnTo: "https://attacker.test" },
      { userId: "owner-a" },
    ]) {
      expect(() => googleLoginStartRequestSchema.parse(input)).toThrow();
    }
  });

  it("exposes only password and Google in a bounded public projection", () => {
    expect(identityHttpRoutes.accountSignInMethods).toBe("/v1/account/sign-in-methods");
    expect(signInMethodSchema.options).toEqual(["password", "google"]);
    expect(
      accountSignInMethodsResponseSchema.parse({
        methods: [
          { linkedAt, method: "password" },
          { linkedAt, method: "google" },
        ],
      }),
    ).toEqual({
      methods: [
        { linkedAt, method: "password" },
        { linkedAt, method: "google" },
      ],
    });
  });

  it("fixes purpose-specific recent-auth and linking routes without caller redirects", () => {
    expect(identityHttpRoutes.passwordReauthentication).toBe("/v1/auth/reauthenticate/password");
    expect(identityHttpRoutes.googleReauthenticationStart).toBe(
      "/v1/auth/reauthenticate/google/start",
    );
    expect(identityHttpRoutes.googleReauthenticationContinue).toBe(
      "/v1/auth/reauthenticate/google/continue",
    );
    expect(identityHttpRoutes.googleLinkStart).toBe("/v1/account/sign-in-methods/google:start");
    expect(identityHttpRoutes.googleLinkContinue).toBe(
      "/v1/account/sign-in-methods/google:continue",
    );
    expect(identityHttpRoutes.passwordLink).toBe("/v1/account/sign-in-methods/password");
    expect(googleLinkStartRequestSchema.parse({})).toEqual({});
    expect(
      googleLinkStartResponseSchema.parse({
        continuePath: "/v1/account/sign-in-methods/google:continue",
      }),
    ).toEqual({ continuePath: "/v1/account/sign-in-methods/google:continue" });
    for (const input of [
      { email: "learner@example.com" },
      { returnTo: "https://attacker.test" },
      { userId: "owner-a" },
    ]) {
      expect(() => googleLinkStartRequestSchema.parse(input)).toThrow();
    }
  });

  it("accepts only bounded password proof without account identity fields", () => {
    expect(
      passwordReauthenticationRequestSchema.parse({
        password: "correct horse battery staple",
      }),
    ).toEqual({ password: "correct horse battery staple" });
    expect(passwordLinkRequestSchema.parse({ password: "correct horse battery staple" })).toEqual({
      password: "correct horse battery staple",
    });
    for (const schema of [passwordReauthenticationRequestSchema, passwordLinkRequestSchema]) {
      for (const input of [
        { password: "short" },
        { email: "learner@example.com", password: "correct horse battery staple" },
        { password: "correct horse battery staple", userId: "owner-a" },
      ]) {
        expect(() => schema.parse(input)).toThrow();
      }
    }
  });

  it("publishes one stable conflict for an already linked method", () => {
    expect(apiErrorCodeSchema.parse("sign_in_method_already_linked")).toBe(
      "sign_in_method_already_linked",
    );
  });

  it("rejects unknown methods, excess entries, and identity-provider secrets", () => {
    expect(() =>
      accountSignInMethodsResponseSchema.parse({
        methods: [{ linkedAt, method: "magic-link" }],
      }),
    ).toThrow();
    expect(() => accountSignInMethodsResponseSchema.parse({ methods: [] })).toThrow();
    expect(() =>
      accountSignInMethodsResponseSchema.parse({
        methods: Array.from({ length: 3 }, () => ({ linkedAt, method: "password" })),
      }),
    ).toThrow();
    for (const methods of [
      [
        { linkedAt, method: "google" },
        { linkedAt, method: "password" },
      ],
      [
        { linkedAt, method: "password" },
        { linkedAt, method: "password" },
      ],
    ]) {
      expect(() => accountSignInMethodsResponseSchema.parse({ methods })).toThrow();
    }
    for (const extra of [
      { identityId: "provider-identity" },
      { ownerUserId: "10000000-0000-4000-8000-000000000001" },
      { providerSubject: "subject" },
      { token: "secret" },
    ]) {
      expect(() =>
        accountSignInMethodsResponseSchema.parse({
          methods: [{ linkedAt, method: "password", ...extra }],
        }),
      ).toThrow();
    }
  });
});
