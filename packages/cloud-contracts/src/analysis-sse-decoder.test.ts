import { describe, expect, it } from "vitest";

import { contractFixtures } from "./fixtures.js";
import { createAnalysisSseDecoder } from "./analysis-sse-decoder.js";

describe("analysis SSE decoder", () => {
  it("emits only after a complete strict envelope arrives across chunks", () => {
    const decoder = createAnalysisSseDecoder();
    const event = JSON.stringify(contractFixtures.completedEvent);

    expect(decoder.push(`event: analysis\nid: 1\ndata: ${event.slice(0, 30)}`)).toEqual([]);
    expect(decoder.push(`${event.slice(30)}\n\n`)).toEqual([contractFixtures.completedEvent]);
    expect(decoder.finish()).toEqual([]);
  });

  it("rejects incomplete, duplicate, and unknown envelope fields", () => {
    const duplicate = createAnalysisSseDecoder();
    expect(() => duplicate.push("event: analysis\nevent: analysis\n")).toThrow(
      "Invalid analysis event stream.",
    );

    const unknown = createAnalysisSseDecoder();
    expect(() => unknown.push("retry: 1000\n")).toThrow("Invalid analysis event stream.");

    const incomplete = createAnalysisSseDecoder();
    incomplete.push("event: analysis\nid: 1\n");
    expect(() => incomplete.finish()).toThrow("Incomplete analysis event stream.");

    const malformed = createAnalysisSseDecoder();
    expect(() => malformed.push("event: analysis\nid: 1\ndata: {\n\n")).toThrow(
      "Invalid analysis event stream.",
    );

    const oversized = createAnalysisSseDecoder({ eventCharacters: 4, totalCharacters: 10 });
    expect(() => oversized.push("12345")).toThrow("Analysis event stream exceeded its limit.");
  });
});
