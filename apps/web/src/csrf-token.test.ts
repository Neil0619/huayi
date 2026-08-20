import { describe, expect, it, vi } from "vitest";

import { fetchCsrfToken } from "./csrf-token.js";

describe("Web CSRF bootstrap", () => {
  it("uses the fixed API route with Web session credentials", async () => {
    const csrfToken = "c".repeat(32);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ access: "full", csrfToken }));
    await expect(fetchCsrfToken("https://api.huayi.example", fetch)).resolves.toBe(csrfToken);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.huayi.example/v1/auth/csrf");
    expect(fetch.mock.calls[0]?.[1]).toEqual({
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("rejects unknown response fields", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ access: "full", csrfToken: "csrf-token", userId: "attacker" }),
      );
    await expect(fetchCsrfToken("https://api.huayi.example", fetch)).rejects.toThrow();
  });

  it("fails without exposing an error response body", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("private response", { status: 401 }));
    await expect(fetchCsrfToken("https://api.huayi.example", fetch)).rejects.toThrow(
      "Huayi CSRF bootstrap failed with 401.",
    );
  });
});
