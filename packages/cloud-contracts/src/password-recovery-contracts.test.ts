import { describe, expect, it } from "vitest";

import {
  passwordRecoveryAcceptedResponseSchema,
  passwordRecoveryCallbackFormSchema,
  passwordRecoveryCompleteRequestSchema,
  passwordRecoveryConfirmQuerySchema,
  passwordRecoveryHttpRoutes,
  passwordRecoveryRunResponseSchema,
  passwordRecoverySessionResponseSchema,
  passwordRecoveryStartRequestSchema,
} from "./password-recovery-contracts.js";

const csrfToken = "c".repeat(32);

describe("password recovery contracts", () => {
  it("fixes public and internal routes without caller-controlled redirects", () => {
    expect(passwordRecoveryHttpRoutes).toEqual({
      callback: "/v1/auth/password/recovery/callback",
      complete: "/v1/auth/password/recovery/complete",
      confirm: "/v1/auth/password/recovery/confirm",
      run: "/internal/password-recovery/run",
      session: "/v1/auth/password/recovery/session",
      start: "/v1/auth/password/recovery",
    });
  });

  it("normalizes only a strict email request and exposes one uniform acceptance", () => {
    expect(passwordRecoveryStartRequestSchema.parse({ email: " Learner@Example.COM " })).toEqual({
      email: "learner@example.com",
    });
    expect(passwordRecoveryAcceptedResponseSchema.parse({ accepted: true })).toEqual({
      accepted: true,
    });
    for (const input of [
      { email: "not-an-email" },
      { email: "learner@example.com", returnTo: "https://attacker.test" },
      { email: "learner@example.com", userId: "owner-a" },
    ]) {
      expect(() => passwordRecoveryStartRequestSchema.parse(input)).toThrow();
    }
    expect(() =>
      passwordRecoveryAcceptedResponseSchema.parse({ accepted: true, flow: "secret" }),
    ).toThrow();
  });

  it("keeps email confirmation proof bounded and exact", () => {
    const proof = { code: "p".repeat(32), flow: "f".repeat(32) };
    expect(passwordRecoveryConfirmQuerySchema.parse(proof)).toEqual(proof);
    expect(passwordRecoveryCallbackFormSchema.parse(proof)).toEqual(proof);
    for (const schema of [passwordRecoveryConfirmQuerySchema, passwordRecoveryCallbackFormSchema]) {
      for (const input of [
        { code: "short", flow: proof.flow },
        { code: proof.code, flow: "short" },
        { ...proof, returnTo: "https://attacker.test" },
      ]) {
        expect(() => schema.parse(input)).toThrow();
      }
    }
  });

  it("exposes only expiring CSRF proof and accepts only one bounded new password", () => {
    expect(
      passwordRecoverySessionResponseSchema.parse({
        csrfToken,
        expiresAt: "2026-08-14T10:15:00.000Z",
      }),
    ).toEqual({ csrfToken, expiresAt: "2026-08-14T10:15:00.000Z" });
    expect(
      passwordRecoveryCompleteRequestSchema.parse({
        password: "correct horse battery staple",
      }),
    ).toEqual({ password: "correct horse battery staple" });
    for (const input of [
      { password: "short" },
      { password: "p".repeat(257) },
      { email: "learner@example.com", password: "correct horse battery staple" },
      { confirmPassword: "correct horse battery staple", password: "correct horse battery staple" },
    ]) {
      expect(() => passwordRecoveryCompleteRequestSchema.parse(input)).toThrow();
    }
    for (const input of [
      { csrfToken: "short", expiresAt: "2026-08-14T10:15:00.000Z" },
      { csrfToken, expiresAt: "not-a-date" },
      { csrfToken, email: "learner@example.com", expiresAt: "2026-08-14T10:15:00.000Z" },
    ]) {
      expect(() => passwordRecoverySessionResponseSchema.parse(input)).toThrow();
    }
  });

  it("bounds the internal worker projection to one stable outcome", () => {
    for (const outcome of ["failed", "idle", "sent"] as const) {
      expect(passwordRecoveryRunResponseSchema.parse({ outcome })).toEqual({ outcome });
    }
    expect(() => passwordRecoveryRunResponseSchema.parse({ outcome: "retrying" })).toThrow();
    expect(() =>
      passwordRecoveryRunResponseSchema.parse({ outcome: "sent", flowId: "secret" }),
    ).toThrow();
  });
});
