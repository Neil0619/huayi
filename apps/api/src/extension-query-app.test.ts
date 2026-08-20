import { extensionQueryHttpRoutes } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createExtensionQueryApp } from "./extension-query-app.js";

describe("ExtensionQuery HTTP adapter", () => {
  it("authenticates the extension and streams strict query events", async () => {
    const prepare = vi.fn(async () =>
      (async function* () {
        yield { generationId: "generation-1", type: "query.started" as const };
      })(),
    );
    const app = createExtensionQueryApp({
      authenticate: async () => "owner-a",
      module: { get: vi.fn(), prepare } as never,
    });
    const response = await app.request(extensionQueryHttpRoutes.start, {
      body: JSON.stringify({
        action: "explain",
        selectionKind: "sentence",
        sourceText: "The plan fell through.",
        sourceType: "web-selection",
      }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "query-key" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: query");
    expect(text).toContain("id: 1");
    expect(text).toContain('"type":"query.started"');
    expect(prepare).toHaveBeenCalledWith({
      idempotencyKey: "query-key",
      input: {
        action: "explain",
        selectionKind: "sentence",
        sourceText: "The plan fell through.",
        sourceType: "web-selection",
      },
      userId: "owner-a",
    });
  });

  it("returns an owner-scoped temporary generation with no-store caching", async () => {
    const get = vi.fn(async () => ({
      createdAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-13T01:00:00.000Z",
      id: "generation-1",
      state: "running" as const,
    }));
    const app = createExtensionQueryApp({
      authenticate: async () => "owner-a",
      module: { get, prepare: vi.fn() } as never,
    });
    const response = await app.request("/v1/extension-query-generations/generation-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(get).toHaveBeenCalledWith("owner-a", "generation-1");
  });
});
