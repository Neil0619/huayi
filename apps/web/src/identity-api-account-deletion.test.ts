import { describe, expect, it, vi } from "vitest";

import { createWebIdentityApi } from "./identity-api.js";

const origin = "https://api.huayi.invalid";
const accepted = {
  accepted: true as const,
  requestedAt: "2026-08-13T01:00:00.000Z",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
const deletionKeyAt = (
  request: ReturnType<
    typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
  >,
  index: number,
) => new Headers(request.mock.calls[index]?.[1]?.headers).get("idempotency-key");

describe("Web identity API account-deletion authority", () => {
  it("reuses the deletion proof after transport or HTTP failure and clears it after acceptance", async () => {
    const request = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("network response lost"))
      .mockResolvedValueOnce(
        json(
          {
            error: { code: "internal_error", message: "hidden", requestId: "request-1" },
          },
          503,
        ),
      )
      .mockResolvedValueOnce(json(accepted, 202))
      .mockResolvedValueOnce(json(accepted, 202));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.deleteAccount("c".repeat(32))).rejects.toThrow("network response lost");
    await expect(api.deleteAccount("c".repeat(32))).rejects.toMatchObject({ status: 503 });
    await expect(api.deleteAccount("c".repeat(32))).resolves.toEqual(accepted);
    await expect(api.deleteAccount("c".repeat(32))).resolves.toEqual(accepted);

    expect(deletionKeyAt(request, 0)).toMatch(/^[0-9a-f-]{36}$/u);
    expect(deletionKeyAt(request, 1)).toBe(deletionKeyAt(request, 0));
    expect(deletionKeyAt(request, 2)).toBe(deletionKeyAt(request, 1));
    expect(deletionKeyAt(request, 3)).not.toBe(deletionKeyAt(request, 2));
    expect(request.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({ confirmation: "delete-account" }),
    );
  });

  it("clears an unresolved deletion proof after a successful logout", async () => {
    const request = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("network response lost"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(accepted, 202));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.deleteAccount("c".repeat(32))).rejects.toThrow("network response lost");
    await api.logout("c".repeat(32));
    await api.deleteAccount("c".repeat(32));

    expect(deletionKeyAt(request, 2)).not.toBe(deletionKeyAt(request, 0));
    expect(request).toHaveBeenNthCalledWith(2, new URL("/v1/auth/logout", origin), {
      credentials: "include",
      headers: { "X-CSRF-Token": "c".repeat(32) },
      method: "POST",
    });
  });

  it("clears an unresolved deletion proof after a successful password login", async () => {
    const request = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("network response lost"))
      .mockResolvedValueOnce(json({ access: "full", csrfToken: "n".repeat(32) }))
      .mockResolvedValueOnce(json(accepted, 202));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.deleteAccount("c".repeat(32))).rejects.toThrow("network response lost");
    await api.loginPassword("other@example.com", "password long enough");
    await api.deleteAccount("n".repeat(32));

    expect(deletionKeyAt(request, 2)).not.toBe(deletionKeyAt(request, 0));
  });
});
