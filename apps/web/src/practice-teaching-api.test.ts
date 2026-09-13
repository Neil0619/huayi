import { expect, it, vi } from "vitest";
import { createWebPracticeApi } from "./practice-api.js";
import { teachingFixture } from "./practice-teaching.test-support.js";

it("reads teaching separately and writes an explicit versioned action with CSRF and idempotency", async () => {
  const detail = teachingFixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(detail));
  const api = createWebPracticeApi({
    apiOrigin: "https://practice.invalid",
    fetch,
    csrfToken: async () => "csrf-local",
  });
  expect(await api.teaching.get(detail.session.id)).toEqual(detail);
  await api.teaching.act(
    detail.session.id,
    { action: "reveal-hint", expectedRevision: 2, expectedControlRevision: 0, ordinal: 0 },
    "hint-once",
  );
  expect(String(fetch.mock.calls[0]?.[0])).toBe(
    "https://practice.invalid/v2/practice/sessions/teaching-session/teaching",
  );
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", method: "GET" });
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    method: "POST",
    credentials: "include",
    headers: expect.objectContaining({
      "x-csrf-token": "csrf-local",
      "idempotency-key": "hint-once",
    }),
  });
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
    action: "reveal-hint",
    expectedRevision: 2,
    expectedControlRevision: 0,
    ordinal: 0,
  });
});

it("rejects another session's valid detail and invalid IDs before displaying a target", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(teachingFixture()));
  const api = createWebPracticeApi({
    apiOrigin: "https://practice.invalid",
    fetch,
    csrfToken: async () => "csrf-local",
  });
  await expect(api.teaching.get("different-session")).rejects.toThrow();
  await expect(api.teaching.get("bad/id")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
