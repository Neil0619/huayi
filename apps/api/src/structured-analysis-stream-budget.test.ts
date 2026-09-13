import { createAnalysisSseDecoder } from "@huayi/cloud-contracts";
import { expect, it, vi } from "vitest";
import { createAnalysisApp } from "./analysis-app.js";
import { createAnalysisModule } from "./analysis-module.js";
import {
  createDeepSeekAnalysisModel,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";
import { createInMemoryAnalysisRequestLifecycle } from "./analysis-request-lifecycle.js";
import {
  createInMemoryAnalysisCommitter,
  createInMemoryAnalysisRepository,
} from "./analysis-repository.js";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";
import {
  structuredProviderInput,
  structuredProviderOutput,
} from "./test-support/structured-provider-fixture.js";

function invalidPreviewResponse() {
  const value = structuredProviderOutput();
  value.previewZh = "中".repeat(16_000);
  const prefix = '{"previewZh":"';
  const chunks = [
    prefix,
    ...value.previewZh,
    JSON.stringify(value).slice(prefix.length + value.previewZh.length),
  ];
  const frames = chunks.map(
    (content) =>
      `data: ${JSON.stringify({
        id: "offline-stream",
        model: "deepseek-flash",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
  );
  frames.push(
    `data: ${JSON.stringify({
      id: "offline-stream",
      model: "deepseek-flash",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })}\n\ndata: [DONE]\n\n`,
  );
  return new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

it("bounds actual encoded preview frames and still saves, settles, and delivers a repaired success to the old reader", async () => {
  const providerFetch = vi
    .fn<DeepSeekAnalysisFetch>()
    .mockResolvedValueOnce(invalidPreviewResponse())
    .mockResolvedValueOnce(simulatedProviderResponse(structuredProviderOutput(), false));
  const model = createDeepSeekAnalysisModel({
    apiKey: "offline-key",
    fetch: providerFetch,
    prices: {
      cachedInputMicroUsdPerMillionTokens: 500_000,
      inputMicroUsdPerMillionTokens: 1_000_000,
      outputMicroUsdPerMillionTokens: 2_000_000,
    },
  });
  const repository = createInMemoryAnalysisRepository();
  const quota = new FakeAnalysisQuota();
  const lifecycle = createInMemoryAnalysisRequestLifecycle({ now: () => new Date() });
  let id = 0;
  const module = createAnalysisModule({
    model,
    repository,
    quota,
    requestLifecycle: lifecycle,
    ids: () => `10000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    clock: { now: () => new Date() },
    cursorKey: new Uint8Array(32).fill(7),
    studyCaptures: { get: async () => null },
    committer: createInMemoryAnalysisCommitter(repository, quota, lifecycle),
  });
  const app = createAnalysisApp({ module, authenticate: () => "owner" });
  const response = await app.request("/v1/analyses:stream", {
    method: "POST",
    body: JSON.stringify(structuredProviderInput),
    headers: { "Content-Type": "application/json", "Idempotency-Key": "bounded-native" },
  });
  expect(response.status).toBe(200);
  const wire = await response.text();
  const decoder = createAnalysisSseDecoder();
  const events = decoder.push(wire);
  decoder.finish();
  const done = events.find((event) => event.type === "analysis.completed");
  if (!done) throw new Error("Old reader did not receive the completed analysis.");
  expect(wire.length).toBeLessThan(700 * 1024);
  expect(Buffer.byteLength(wire, "utf8")).toBeLessThan(700 * 1024);
  expect(events.filter((event) => event.type === "analysis.preview").length).toBeLessThan(16_000);
  expect(done.analysis.result.type).toBe("sentence-passage-analysis-v2");
  expect((await repository.findById("owner", done.analysis.id))?.result.type).toBe(
    "sentence-passage-analysis-v3",
  );
  expect(providerFetch).toHaveBeenCalledTimes(2);
  expect(quota.settlements).toHaveLength(1);
  expect(quota.settlements[0]).toMatchObject({ outcome: "succeeded", actualCostMicroUsd: 148 });
});
