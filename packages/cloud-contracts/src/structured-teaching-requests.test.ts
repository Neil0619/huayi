import { describe, expect, it } from "vitest";
import { startAnalysisRequestSchema } from "./analysis-contracts.js";
import {
  extensionQueryRequestSchema,
  studyCaptureAnalyzeRequestSchema,
} from "./extension-learning-contracts.js";
import {
  acceptsStructuredTeaching,
  captureAnalysisGenerationRequestSchema,
  extensionQueryGenerationRequestSchema,
  startAnalysisGenerationRequestSchema,
  structuredTeachingAccept,
} from "./structured-teaching-requests.js";

const analysis = { selectionKind: "sentence", source: { type: "manual" }, sourceText: "We can." };
const query = {
  action: "explain",
  selectionKind: "sentence",
  sourceText: "We can.",
  sourceType: "web-selection",
};
const capture = { expectedRevision: 3, intent: "reanalysis" };
describe("explicit structured teaching generation and read capability", () => {
  it("preserves old requests and requires the exact explicit contract for new generation", () => {
    for (const [schema, oldSchema, request] of [
      [startAnalysisGenerationRequestSchema, startAnalysisRequestSchema, analysis],
      [extensionQueryGenerationRequestSchema, extensionQueryRequestSchema, query],
      [captureAnalysisGenerationRequestSchema, studyCaptureAnalyzeRequestSchema, capture],
    ] as const) {
      expect(schema.parse(request)).toEqual(request);
      const updated = { ...request, outputContract: "structured-teaching-v1" };
      expect(schema.parse(updated)).toEqual(updated);
      expect(() => oldSchema.parse(updated)).toThrow();
      for (const outputContract of ["v3", "", null, 3])
        expect(() => schema.parse({ ...request, outputContract })).toThrow();
    }
  });

  it("retains the exact-selection query restriction after adding the new field", () => {
    expect(() =>
      extensionQueryGenerationRequestSchema.parse({
        ...query,
        outputContract: "structured-teaching-v1",
        sentenceContext: "Another sentence.",
      }),
    ).toThrow();
    expect(
      extensionQueryGenerationRequestSchema.parse({
        ...query,
        selectionKind: "word",
        sourceText: "can",
        outputContract: "structured-teaching-v1",
        sentenceContext: "We can.",
      }),
    ).toHaveProperty("sentenceContext", "We can.");
  });

  it("recognizes explicit JSON and SSE capabilities without inferring generation consent", () => {
    expect(acceptsStructuredTeaching(structuredTeachingAccept.json, "json")).toBe(true);
    expect(acceptsStructuredTeaching(structuredTeachingAccept.eventStream, "eventStream")).toBe(
      true,
    );
    expect(
      acceptsStructuredTeaching(
        `application/json, ${structuredTeachingAccept.eventStream};q=0.8`,
        "eventStream",
      ),
    ).toBe(true);
    expect(
      acceptsStructuredTeaching(
        'Application/JSON; Profile="seen-said.structured-teaching-v1"',
        "json",
      ),
    ).toBe(true);
    expect(startAnalysisGenerationRequestSchema.parse(analysis)).not.toHaveProperty(
      "outputContract",
    );
  });

  it("does not opt old, malformed, disabled or ambiguous Accept headers into new output", () => {
    for (const accept of [
      undefined,
      "*/*",
      "application/json",
      "text/event-stream;version=2",
      `${structuredTeachingAccept.json};q=0`,
      `${structuredTeachingAccept.json};q=0.000`,
      `${structuredTeachingAccept.json};profile=other`,
      `${structuredTeachingAccept.json};q=1;q=0`,
      'application/json;profile="other,application/json;profile=seen-said.structured-teaching-v1"',
      'application/json;profile="seen-said.structured-teaching-v1',
      'application/json;profile="seen-said.structured-teaching-v1" trailing',
      "application/json;profile=seen-said.structured-teaching-v10",
      `${structuredTeachingAccept.json};version=2`,
      `${structuredTeachingAccept.json};q=1.1`,
      `${structuredTeachingAccept.json};q="0.8"`,
      `${structuredTeachingAccept.json};q=0, ${structuredTeachingAccept.json}`,
      `${structuredTeachingAccept.json}, ${structuredTeachingAccept.json};q=0`,
      `${structuredTeachingAccept.json}, ${structuredTeachingAccept.json}`,
    ])
      expect(acceptsStructuredTeaching(accept, "json")).toBe(false);
    expect(
      acceptsStructuredTeaching(
        'text/event-stream;profile="seen-said.structured-teaching-v1";version=20',
        "eventStream",
      ),
    ).toBe(false);
    expect(acceptsStructuredTeaching(structuredTeachingAccept.json, "eventStream")).toBe(false);
    expect(acceptsStructuredTeaching(structuredTeachingAccept.eventStream, "json")).toBe(false);
  });
});
