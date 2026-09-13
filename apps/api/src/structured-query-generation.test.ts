import { projectStoreResultForLegacy, type ExtensionQueryEventRead } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { createExtensionQueryModule } from "./extension-query-module.js";
import type { ExtensionQueryStore } from "./extension-query-ports.js";
import { structuredQueryFixture } from "./test-support/structured-query-fixture.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";

function fixture(nativeOutput = true) {
  const quota = new FakeAnalysisQuota().summary();
  const result = structuredQueryFixture();
  const generated = {
    costMicroUsd: 128,
    usage: { inputTokens: 64, cachedInputTokens: 0, outputTokens: 32 },
    result: nativeOutput ? result : projectStoreResultForLegacy(result),
  };
  const store: ExtensionQueryStore = {
    begin: vi.fn<ExtensionQueryStore["begin"]>(async () => ({
      kind: "acquired",
      id: result.requestId,
      leaseToken: "lease",
    })),
    attachReservation: async () => undefined,
    markDispatched: async () => undefined,
    complete: vi.fn<ExtensionQueryStore["complete"]>(async (c) => ({
      type: "query.completed",
      generationId: c.id,
      quota,
      result: c.result,
    })),
    fail: vi.fn<ExtensionQueryStore["fail"]>(async (c) => ({
      type: "query.failed",
      generationId: c.id,
      quota,
      error: c.error,
    })),
    abandon: vi.fn(),
    find: async () => null,
    terminalizeWithoutReservation: async () => undefined,
  };
  const model = { run: vi.fn(async () => generated) };
  const module = createExtensionQueryModule({
    store,
    model,
    ids: () => "id",
    now: () => new Date(),
    quota: { reserve: async () => ({ id: "reservation" }), summary: () => quota },
    reservedCostMicroUsd: () => 500,
  });
  const input = {
    outputContract: "structured-teaching-v1" as const,
    sourceText: result.sourceText,
    selectionKind: result.selectionKind,
    action: "explain" as const,
    sourceType: "web-selection" as const,
  };
  return { store, model, module, input, generated };
}
async function collect(events: AsyncIterable<ExtensionQueryEventRead>) {
  const values: ExtensionQueryEventRead[] = [];
  for await (const event of events) values.push(event);
  return values;
}
describe("native query generation and known billing", () => {
  it("preserves its saved input contract and emits one validated structure per unit", async () => {
    const f = fixture();
    const events = await collect(
      await f.module.prepare({ input: f.input, userId: "owner", idempotencyKey: "query" }),
    );
    expect(events.map((e) => e.type)).toEqual([
      "query.started",
      "query.structure",
      "query.completed",
    ]);
    expect(events.at(-1)).toMatchObject({ result: f.generated.result });
    expect(f.store.begin).toHaveBeenCalledWith(expect.objectContaining({ input: f.input }));
    expect(f.model.run).toHaveBeenCalledTimes(1);
  });
  it.each(["old-to-new", "new-to-old"])(
    "settles known usage when final validation rejects %s",
    async (direction) => {
      const f = fixture(direction === "new-to-old");
      const { outputContract, ...legacy } = f.input;
      void outputContract;
      const events = await collect(
        await f.module.prepare({
          input: direction === "new-to-old" ? legacy : f.input,
          userId: "owner",
          idempotencyKey: "query",
        }),
      );
      expect(events.at(-1)).toMatchObject({
        type: "query.failed",
        error: { code: "model_output_invalid" },
      });
      expect(f.store.complete).not.toHaveBeenCalled();
      expect(f.store.fail).toHaveBeenCalledWith(
        expect.objectContaining({ costMicroUsd: 128, usage: f.generated.usage }),
      );
      expect(f.model.run).toHaveBeenCalledTimes(1);
    },
  );
});
