import { extensionQueryEventSchema, type AnalysisUpdate } from "@huayi/cloud-contracts";
import { expect, it, vi } from "vitest";
import { createExtensionQueryApp } from "./extension-query-app.js";
import { createQueryModelPreview } from "./query-model-preview.js";
import { createQueryOutputContract } from "./extension-query-output.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";

it("limits tiny provider previews while consuming through the saved, billed terminal event", async () => {
  const input = {
    action: "explain" as const,
    selectionKind: "sentence" as const,
    sourceText: "We can.",
    sourceType: "web-selection" as const,
  };
  const contract = createQueryOutputContract(input);
  const content = {
    type: "explain-sentence",
    selectionKind: "sentence",
    mainStructure: "中".repeat(4000),
    contextRole: "中".repeat(4000),
    translationZh: "中".repeat(4000),
    keyExpressions: [{ text: "can", meaningZh: "能" }],
  };
  expect(contract.parse(JSON.stringify(content), "generation-1").success).toBe(true);
  const updates: AnalysisUpdate[] = [];
  const preview = createQueryModelPreview({
    requestId: "generation-1",
    type: contract.type,
    shape: contract.shape,
    emit: (value) => updates.push(value),
  });
  for (const character of JSON.stringify(content)) preview(character);
  expect(updates.length).toBeGreaterThan(12000);
  const completed = extensionQueryEventSchema.parse({
    type: "query.completed",
    generationId: "generation-1",
    result: { ...content, requestId: "generation-1", sourceText: input.sourceText },
    quota: new FakeAnalysisQuota().summary(),
  });
  if (completed.type !== "query.completed") throw new Error("Expected completion");
  let consumed = 0;
  const save = vi.fn();
  const settle = vi.fn();
  const prepare = vi.fn(async () =>
    (async function* () {
      yield extensionQueryEventSchema.parse({
        type: "query.started",
        generationId: "generation-1",
      });
      for (const update of updates) {
        consumed += 1;
        yield extensionQueryEventSchema.parse({
          type: "query.preview-v2",
          version: 2,
          generationId: "generation-1",
          update,
        });
      }
      save(completed.result);
      settle(completed.quota);
      yield completed;
    })(),
  );
  const app = createExtensionQueryApp({
    authenticate: () => "owner",
    module: { get: async () => null, prepare },
  });
  const response = await app.request("/v1/extension-queries:stream", {
    method: "POST",
    headers: {
      Accept: "text/event-stream;version=2",
      "Content-Type": "application/json",
      "Idempotency-Key": "query",
    },
    body: JSON.stringify(input),
  });
  const raw = await response.text();
  expect(Buffer.byteLength(raw, "utf8")).toBeLessThan(2 * 1024 * 1024);
  const messages = raw
    .trimEnd()
    .split("\n\n")
    .map((frame, index) => {
      expect(frame).toContain(`\nid: ${index + 1}`);
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!data) throw new Error("Missing data");
      return extensionQueryEventSchema.parse(JSON.parse(data.slice(6)) as unknown);
    });
  expect(messages.at(-1)).toEqual(completed);
  expect(consumed).toBe(updates.length);
  expect(save).toHaveBeenCalledExactlyOnceWith(completed.result);
  expect(settle).toHaveBeenCalledExactlyOnceWith(completed.quota);
  expect(prepare).toHaveBeenCalledTimes(1);
});
