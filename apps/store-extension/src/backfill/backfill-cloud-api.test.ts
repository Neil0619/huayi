import { expect, it, vi } from "vitest";
import { BackfillCloudError, createBackfillCloudApi } from "./backfill-cloud-api.js";

it.each([400, 401, 403, 404, 409, 422])(
  "recognizes HTTP %s as a definite refusal, not an unknown write result",
  async (status) => {
    const api = createBackfillCloudApi("https://api.example.test", "1.0.0", async () =>
      Response.json({ error: { code: "forbidden", message: "disabled" } }, { status }),
    );
    await expect(
      api.command("a".repeat(43), crypto.randomUUID(), {
        action: "discover",
        origin: "local",
        headwords: ["apple"],
      }),
    ).rejects.toMatchObject({ permanent: true });
  },
);
it.each([408, 425, 429, 500, 503])("retains retries for HTTP %s", async (status) => {
  const api = createBackfillCloudApi(
    "https://api.example.test",
    "1.0.0",
    async () => new Response("", { status }),
  );
  await expect(
    api.command("a".repeat(43), crypto.randomUUID(), { action: "claim" }),
  ).rejects.toEqual(expect.objectContaining({ permanent: false }));
  expect(new BackfillCloudError(false, "connection")).toBeInstanceOf(Error);
});

it.each(["private-response", "{}", "x".repeat(256_001)])(
  "treats malformed and oversized successful responses as safe uncertain failures",
  async (body) => {
    const api = createBackfillCloudApi(
      "https://api.example.test",
      "1.0.0",
      async () => new Response(body),
    );
    await expect(
      api.command("a".repeat(43), crypto.randomUUID(), { action: "claim" }),
    ).rejects.toMatchObject({
      code: "request-failed",
      permanent: false,
    });
  },
);

it("requests and decodes 100 cloud headwords and sends the full receipt", async () => {
  const headwords = Array.from(
    { length: 100 },
    (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
  );
  const status = {
    scopeId: "account",
    enabled: true,
    dailyHour: 8,
    revision: 1,
    pendingCount: 101,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  };
  const requests: unknown[] = [];
  const api = createBackfillCloudApi("https://api.example.test", "1.0.0", async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      status,
      accepted: true,
      batch:
        requests.length === 1
          ? { token: "lease", headwords, expiresAt: "2099-01-01T00:00:00Z" }
          : null,
      nextCursor: null,
    });
  });
  const response = await api.command("a".repeat(43), crypto.randomUUID(), {
    action: "claim",
    limit: 100,
  });
  expect(response.batch?.headwords).toEqual(headwords);
  await api.command("a".repeat(43), crypto.randomUUID(), {
    action: "resolve",
    token: "lease",
    confirmed: headwords,
    rejected: [],
  });
  expect(requests).toEqual([
    { action: "claim", limit: 100 },
    { action: "resolve", token: "lease", confirmed: headwords, rejected: [] },
  ]);
});

it("does not silently issue a second claim when an old API refuses the new limit", async () => {
  const fetcher = vi.fn(async () => new Response("", { status: 400 }));
  const api = createBackfillCloudApi("https://api.example.test", "1.0.0", fetcher);
  await expect(
    api.command("a".repeat(43), crypto.randomUUID(), { action: "claim", limit: 100 }),
  ).rejects.toMatchObject({ permanent: true });
  expect(fetcher).toHaveBeenCalledOnce();
});
