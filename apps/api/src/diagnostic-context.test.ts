import { describe, expect, it, vi } from "vitest";
import {
  captureDiagnostic,
  runDiagnosticScope,
  setDiagnosticContext,
} from "./diagnostic-context.js";

const first = "71000000-0000-4000-8000-000000000001";
const second = "71000000-0000-4000-8000-000000000002";
describe("request diagnostic scopes", () => {
  it("does not open a logging database connection for expected unauthenticated rejections", async () => {
    const write = vi.fn(async () => undefined);
    await runDiagnosticScope({ requestId: first, write }, async () => {
      for (const code of [
        "authentication_required",
        "forbidden",
        "client_upgrade_required",
      ] as const)
        captureDiagnostic({ code, stage: "http" });
    });
    expect(write).not.toHaveBeenCalled();
  });
  it("isolates concurrent requests, deduplicates phases and awaits persistence", async () => {
    const write = vi.fn(async () => undefined);
    await Promise.all(
      [first, second].map((requestId) =>
        runDiagnosticScope({ requestId, write }, async () => {
          setDiagnosticContext({ userId: requestId, operation: "instant-query" });
          await Promise.resolve();
          captureDiagnostic({ code: "model_unavailable", stage: "http", httpStatus: 429 });
          captureDiagnostic({ code: "model_unavailable", stage: "http", httpStatus: 429 });
        }),
      ),
    );
    expect(write).toHaveBeenCalledTimes(2);
    for (const [records] of write.mock.calls as unknown as [
      { userId: string; event: { requestId: string } }[],
    ][]) {
      expect(records).toHaveLength(1);
      expect(records[0]?.event.requestId).toBe(records[0]?.userId);
    }
  });
  it("does not leak Error content or turn a logging outage into a business failure", async () => {
    const fallback = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      runDiagnosticScope(
        {
          requestId: first,
          write: async () => {
            throw new Error("secret database URL");
          },
        },
        async () => {
          captureDiagnostic({ code: "internal_error", stage: "internal" });
          return 42;
        },
      ),
    ).resolves.toBe(42);
    expect(JSON.stringify(fallback.mock.calls)).not.toContain("secret");
    expect(fallback).toHaveBeenCalled();
    fallback.mockRestore();
  });
});
