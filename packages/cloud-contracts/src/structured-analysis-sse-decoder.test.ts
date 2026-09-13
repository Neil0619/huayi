import { expect, it } from "vitest";
import { assembleSentenceStructure } from "@huayi/learning-domain";
import { createStructuredAnalysisSseDecoder } from "./structured-analysis-sse-decoder.js";
import { createAnalysisSseDecoder } from "./analysis-sse-decoder.js";
import { contractFixtures } from "./fixtures.js";
const unit = {
  analysisUnitId: "u1",
  ordinal: 0,
  sourceText: "Go now.",
  sentenceStructure: assembleSentenceStructure("Go now.", {
    kind: "sentence",
    coreClauses: [
      { fragments: [{ text: "Go", occurrence: 1 }], explanationZh: "祈使句要求行动。" },
    ],
    modifiers: [],
  }),
};
const native = { type: "analysis.structure", requestId: "request-1", unit };
const encode = (data: unknown) =>
  `event: analysis\r\nid: 1\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
it("reads a native structure and legacy completion across every character boundary", () => {
  for (const event of [native, contractFixtures.completedEvent]) {
    const decoder = createStructuredAnalysisSseDecoder();
    const values = [...encode(event)].flatMap((character) => decoder.push(character));
    expect([...values, ...decoder.finish()]).toEqual([event]);
  }
});
it("leaves the old reader strict and rejects forged native source references", () => {
  expect(() => createAnalysisSseDecoder().push(encode(native))).toThrow();
  expect(() =>
    createStructuredAnalysisSseDecoder().push(
      encode({ ...native, unit: { ...unit, sourceText: "Stop now." } }),
    ),
  ).toThrow();
});
it("enforces bounded framing on fragmented input and rejects incomplete or duplicate fields", () => {
  const decoder = createStructuredAnalysisSseDecoder();
  decoder.push(": " + "x".repeat(64000));
  expect(() => decoder.push("x".repeat(1600))).toThrow();
  expect(() =>
    createStructuredAnalysisSseDecoder().push("event: analysis\nevent: analysis\n"),
  ).toThrow();
  const partial = createStructuredAnalysisSseDecoder();
  partial.push(encode(native).slice(0, -1));
  expect(() => partial.finish()).toThrow();
});
