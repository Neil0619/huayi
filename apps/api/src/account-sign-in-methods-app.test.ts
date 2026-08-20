import { describe, expect, it, vi } from "vitest";

import { accountSignInMethodsResponseSchema } from "@huayi/cloud-contracts";

import { createAccountSignInMethodsApp } from "./account-sign-in-methods-app.js";

describe("AccountSignInMethods HTTP adapter", () => {
  it("returns only the authenticated owner's canonical no-store projection", async () => {
    const authenticate = vi.fn(async () => "owner-a");
    const read = vi.fn(async () => [
      { linkedAt: new Date("2026-08-14T00:00:00.000Z"), method: "password" as const },
      { linkedAt: new Date("2026-08-14T01:00:00.000Z"), method: "google" as const },
    ]);
    const app = createAccountSignInMethodsApp({ authenticate, read });

    const response = await app.request("/v1/account/sign-in-methods", {
      headers: { cookie: "huayi_session=opaque" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(accountSignInMethodsResponseSchema.parse(await response.json())).toEqual({
      methods: [
        { linkedAt: "2026-08-14T00:00:00.000Z", method: "password" },
        { linkedAt: "2026-08-14T01:00:00.000Z", method: "google" },
      ],
    });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith("owner-a");
  });

  it("fails closed when a repository returns a secret-shaped or empty projection", async () => {
    for (const value of [
      [],
      [
        {
          linkedAt: new Date("2026-08-14T00:00:00.000Z"),
          method: "password" as const,
          token: "secret",
        },
      ],
    ]) {
      const app = createAccountSignInMethodsApp({
        authenticate: async () => "owner-a",
        read: async () => value,
      });
      expect((await app.request("/v1/account/sign-in-methods")).status).toBe(500);
    }
  });
});
