import { describe, expect, it } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import {
  createRuntimeMessageListener,
  handleContentMessage,
  type RequestCoordinatorLike,
} from "./service-worker.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 1,
  selection: "investigation",
  selectionKind: "word",
  targetLanguage: "zh-CN",
  type: "analyze",
};

class FakeCoordinator implements RequestCoordinatorLike {
  readonly cancellations: { requestId: string; tabId: number }[] = [];
  readonly starts: { request: AnalyzeRequest; tabId: number }[] = [];

  cancel(tabId: number, requestId: string): boolean {
    this.cancellations.push({ requestId, tabId });
    return true;
  }

  start(tabId: number, analyzeRequest: AnalyzeRequest): void {
    this.starts.push({ request: analyzeRequest, tabId });
  }
}

describe("handleContentMessage", () => {
  it("routes valid analyze and cancel commands for a sender tab", () => {
    const coordinator = new FakeCoordinator();

    expect(handleContentMessage({ request, type: "ANALYZE_SELECTION" }, 7, coordinator)).toBe(true);
    expect(
      handleContentMessage({ requestId: "request-1", type: "CANCEL_ANALYSIS" }, 7, coordinator),
    ).toBe(true);
    expect(coordinator.starts).toEqual([{ request, tabId: 7 }]);
    expect(coordinator.cancellations).toEqual([{ requestId: "request-1", tabId: 7 }]);
  });

  it("ignores malformed messages and messages without a tab", () => {
    const coordinator = new FakeCoordinator();

    expect(handleContentMessage({ type: "ANALYZE_SELECTION" }, 7, coordinator)).toBe(false);
    expect(
      handleContentMessage({ request, type: "ANALYZE_SELECTION" }, undefined, coordinator),
    ).toBe(false);
    expect(coordinator.starts).toEqual([]);
  });

  it("responds synchronously without leaving the Chrome message channel open", () => {
    const coordinator = new FakeCoordinator();
    const listener = createRuntimeMessageListener(coordinator);
    const responses: unknown[] = [];

    expect(
      listener({ request, type: "ANALYZE_SELECTION" }, { tab: { id: 7 } }, (response) =>
        responses.push(response),
      ),
    ).toBe(false);
    expect(responses).toEqual([{ handled: true }]);
  });
});
