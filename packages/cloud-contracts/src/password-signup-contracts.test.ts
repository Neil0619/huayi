import { expect, it } from "vitest";

import {
  passwordSignupCompleteRequestSchema,
  passwordSignupResendRequestSchema,
  passwordSignupSessionResponseSchema,
  passwordSignupStartRequestSchema,
  passwordSignupVerifyRequestSchema,
} from "./password-signup-contracts.js";

it("limits every registration step to its exact inputs", () => {
  const start = { claimTicket: "c".repeat(43), email: " Learner@Example.com " };
  expect(passwordSignupStartRequestSchema.parse(start).email).toBe("learner@example.com");
  expect(
    passwordSignupStartRequestSchema.safeParse({ ...start, password: "a valid long password" })
      .success,
  ).toBe(false);
  expect(passwordSignupVerifyRequestSchema.parse({ token: "012345" })).toEqual({ token: "012345" });
  expect(
    passwordSignupVerifyRequestSchema.safeParse({ token: "012345", email: start.email }).success,
  ).toBe(false);
  expect(passwordSignupResendRequestSchema.safeParse({ email: start.email }).success).toBe(false);
  expect(
    passwordSignupCompleteRequestSchema.safeParse({
      password: "a valid long password",
      userId: "other",
    }).success,
  ).toBe(false);
});

it("never includes provider state or a login credential in the progress projection", () => {
  const session = { csrfToken: "s".repeat(43), email: "learner@example.com", step: "set-password" };
  expect(passwordSignupSessionResponseSchema.parse(session)).toEqual(session);
  for (const privateField of ["password", "refreshToken", "authState", "claimTicket", "flowId"])
    expect(
      passwordSignupSessionResponseSchema.safeParse({ ...session, [privateField]: "private" })
        .success,
    ).toBe(false);
});
