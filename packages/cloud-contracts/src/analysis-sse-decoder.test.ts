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

  it("applies the event limit to each frame when the network coalesces valid events", () => {
    const frames = Array.from({ length: 17 }, (_, index) => {
      const data = {
        type: "analysis.preview",
        requestId: "00000000-0000-4000-8000-000000000001",
        section: "overall",
        text: "字".repeat(4096),
      };
      return `event: analysis\nid: ${index + 1}\ndata: ${JSON.stringify(data)}\n\n`;
    });
    const source = frames.join("");
    expect(source.length).toBeGreaterThan(64 * 1024);
    for (const split of [0, 17, 4220, 4900, source.length - 1]) {
      const decoder = createAnalysisSseDecoder();
      expect([
        ...decoder.push(source.slice(0, split)),
        ...decoder.push(source.slice(split)),
      ]).toHaveLength(17);
      expect(decoder.finish()).toEqual([]);
    }
  });

  it("resets frame counts for heartbeats while retaining individual and total limits", () => {
    const heartbeat = ": heartbeat\n\n";
    const decoder = createAnalysisSseDecoder({
      eventCharacters: heartbeat.length,
      totalCharacters: 1000,
    });
    expect(decoder.push(heartbeat.repeat(5))).toEqual([]);
    expect(() => decoder.push(":".repeat(heartbeat.length + 1))).toThrow("exceeded its limit");
    const total = createAnalysisSseDecoder({ eventCharacters: 100, totalCharacters: 20 });
    expect(() => total.push(heartbeat.repeat(2))).toThrow("exceeded its limit");
  });
});
