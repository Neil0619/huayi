import { expect, it, vi } from "vitest";

import { createWebPasswordSignupApi } from "./password-signup-api.js";

const csrfToken = "s".repeat(43);
const email = "learner@example.com";
const password = "correct horse battery staple";
const claimTicket = "c".repeat(43);

it("sends each registration stage with only its required proof and fields", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ csrfToken, email, step: "verify-email" })));
  const api = createWebPasswordSignupApi(request);
  expect(await api.startPasswordSignup(claimTicket, " Learner@Example.com ")).toEqual({
    csrfToken,
    email,
    step: "verify-email",
  });
  expect(request).toHaveBeenLastCalledWith(
    "/v1/auth/password/signup/start",
    expect.objectContaining({
      body: JSON.stringify({ claimTicket, email }),
      credentials: "include",
      referrerPolicy: "no-referrer",
    }),
  );

  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ csrfToken, email, step: "set-password" })),
  );
  await api.verifyPasswordSignup("012345", csrfToken);
  expect(request).toHaveBeenLastCalledWith(
    "/v1/auth/password/signup/verify",
    expect.objectContaining({
      body: JSON.stringify({ token: "012345" }),
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    }),
  );

  request.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true })));
  await api.resendPasswordSignup(csrfToken);
  expect(request).toHaveBeenLastCalledWith(
    "/v1/auth/password/signup/resend",
    expect.objectContaining({ body: "{}", credentials: "include" }),
  );

  request.mockResolvedValueOnce(new Response(JSON.stringify({ access: "full", csrfToken })));
  await api.completePasswordSignup(password, csrfToken);
  expect(request).toHaveBeenLastCalledWith(
    "/v1/auth/password/signup/complete",
    expect.objectContaining({
      body: JSON.stringify({ password }),
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    }),
  );
});

it("rejects invalid proof before fetch and rejects private fields in public responses", async () => {
  const request = vi.fn();
  const api = createWebPasswordSignupApi(request);
  await expect(api.verifyPasswordSignup("12345", csrfToken)).rejects.toThrow();
  await expect(api.verifyPasswordSignup("123456", "wrong-csrf")).rejects.toThrow();
  await expect(api.completePasswordSignup("short", csrfToken)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        csrfToken,
        email,
        step: "set-password",
        authState: { private: "provider-state" },
      }),
    ),
  );
  await expect(api.getPasswordSignupSession()).rejects.toThrow();
});
