import type { AnalysisRequest } from "@huayi/store-domain";
import { expect, it, vi } from "vitest";
import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import { createDiagnosticQueryEngine } from "./diagnostic-query-engine.js";
import type { DiagnosticOutbox } from "./diagnostic-outbox.js";

const request: AnalysisRequest = {
  action: "explain",
  providerId: "deepseek",
  requestId: "71000000-0000-4000-8000-000000000001",
  selection: "Private selection never leaves diagnostic boundary",
  selectionKind: "sentence",
  sentenceContext: null,
  targetLanguage: "zh-CN",
};
function fixture(error: Error) {
  const outbox: DiagnosticOutbox = {
    begin: async () => ({ sessionHash: "a".repeat(64), consentId: request.requestId }),
    record: vi.fn(async () => undefined),
    flush: async () => undefined,
    clear: async () => undefined,
    cancel: () => undefined,
  };
  const engine = createDiagnosticQueryEngine(
    {
      analyze: async () => {
        throw error;
      },
    },
    outbox,
    "1.0.0",
    "deepseek",
  );
  return { outbox, engine };
}
it("automatically records a local provider rejection without exposing input or changing the thrown error", async () => {
  const error = new BrowserAnalysisError("provider-error", undefined, 429);
  const f = fixture(error);
  await expect(
    f.engine.analyze(request, new AbortController().signal, () => undefined),
  ).rejects.toBe(error);
  expect(f.outbox.record).toHaveBeenCalledWith(
    expect.objectContaining({
      source: "store",
      code: "provider-error",
      httpStatus: 429,
      requestId: request.requestId,
    }),
    expect.any(Object),
  );
  expect(JSON.stringify(vi.mocked(f.outbox.record).mock.calls)).not.toContain(request.selection);
});
it("ignores cancellation and tolerates diagnostic persistence failure", async () => {
  const cancelled = fixture(new BrowserAnalysisError("cancelled"));
  await expect(
    cancelled.engine.analyze(request, new AbortController().signal, () => undefined),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(cancelled.outbox.record).not.toHaveBeenCalled();
  const error = new Error("private exception and token");
  const failure = fixture(error);
  vi.mocked(failure.outbox.record).mockRejectedValue(new Error("disk full"));
  await expect(
    failure.engine.analyze(request, new AbortController().signal, () => undefined),
  ).rejects.toBe(error);
  expect(JSON.stringify(vi.mocked(failure.outbox.record).mock.calls)).not.toContain(error.message);
});
