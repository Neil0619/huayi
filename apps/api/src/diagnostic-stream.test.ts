import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  captureDiagnostic,
  runDiagnosticScope,
  type DiagnosticWriter,
} from "./diagnostic-context.js";
import { streamSSE } from "./diagnostic-stream.js";
import { createDiagnosticProviderFetch } from "./diagnostic-provider-fetch.js";

describe("automatic model diagnostics", () => {
  it("persists a failure after SSE headers returned and before producer completion", async () => {
    const write = vi.fn<DiagnosticWriter>(async () => undefined);
    const app = new Hono();
    app.use("*", async (_c, next) =>
      runDiagnosticScope({ write, requestId: crypto.randomUUID() }, next),
    );
    app.get("/stream", (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ data: "start" });
        await Promise.resolve();
        captureDiagnostic({ code: "model_output_invalid", stage: "content-schema" });
        await stream.writeSSE({ data: "failed" });
      }),
    );
    const response = await app.request("/stream");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("failed");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0][0]?.event).toMatchObject({
      code: "model_output_invalid",
      stage: "content-schema",
    });
  });
  it("keeps upstream HTTP status without reading or logging the body", async () => {
    const write = vi.fn<DiagnosticWriter>(async () => undefined);
    const response = new Response("private upstream response", { status: 429 });
    const fetch = createDiagnosticProviderFetch(async () => response);
    await runDiagnosticScope({ write, requestId: crypto.randomUUID() }, async () => {
      expect(
        await fetch("https://api.deepseek.com/chat/completions", {
          body: "private input",
          credentials: "omit",
          headers: { Authorization: "Bearer secret" },
          method: "POST",
          redirect: "error",
          signal: new AbortController().signal,
        }),
      ).toBe(response);
    });
    expect(write.mock.calls[0]?.[0][0]?.event).toMatchObject({ httpStatus: 429, stage: "http" });
    expect(response.bodyUsed).toBe(false);
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/private|secret/);
  });
});
