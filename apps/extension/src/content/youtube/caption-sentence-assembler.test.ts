import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";
import { describe, expect, it } from "vitest";

import { CaptionSentenceAssembler } from "./caption-sentence-assembler.js";

function requireCapture(assembler: CaptionSentenceAssembler, startedAtMs: number) {
  const capture = assembler.beginCapture(startedAtMs);
  if (capture === null) {
    throw new Error("Expected an active caption capture.");
  }
  return capture;
}

describe("CaptionSentenceAssembler", () => {
  it("joins rolling caption cues without repeating their overlap", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "The investigation was still in its" });
    const capture = requireCapture(assembler, 100);
    expect(capture.text).toBe("The investigation was still in its");

    const update = assembler.observe({
      observedAtMs: 500,
      text: "still in its early stages.",
    });

    expect(update).toMatchObject({
      complete: true,
      text: "The investigation was still in its early stages.",
    });
    expect(assembler.resolveCapture(capture, "boundary")).toEqual({
      completeness: "complete",
      text: "The investigation was still in its early stages.",
    });
  });

  it("ignores duplicate and rolled-back snapshots", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "We are testing a longer caption" });
    assembler.observe({ observedAtMs: 100, text: "We are testing a longer caption today" });
    assembler.observe({ observedAtMs: 200, text: "We are testing a longer caption" });

    expect(assembler.beginCapture(300)?.text).toBe("We are testing a longer caption today");
  });

  it("uses a rolled-back snapshot as the baseline for the next correction", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "We are testing a longer caption today" });
    assembler.observe({ observedAtMs: 100, text: "We are testing a longer caption" });
    assembler.observe({ observedAtMs: 200, text: "longer caption tomorrow." });

    expect(assembler.beginCapture(300)).toMatchObject({
      complete: true,
      text: "We are testing a longer caption tomorrow.",
    });
  });

  it("replaces an unstable automatic-caption tail instead of appending both versions", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "The result is surprising" });
    assembler.observe({ observedAtMs: 200, text: "The result was surprising." });

    expect(assembler.beginCapture(300)).toMatchObject({
      complete: true,
      text: "The result was surprising.",
    });
  });

  it("targets only the last sentence in a snapshot and stops before the following sentence", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "Earlier context. This sentence keeps going" });
    const capture = requireCapture(assembler, 100);
    expect(capture.text).toBe("This sentence keeps going");

    assembler.observe({
      observedAtMs: 400,
      text: "keeps going until here. The next sentence starts",
    });

    expect(assembler.resolveCapture(capture, "boundary")).toEqual({
      completeness: "complete",
      text: "This sentence keeps going until here.",
    });
  });

  it("uses the trailing sentence as the baseline for the next capture", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "This sentence keeps going" });
    const firstCapture = requireCapture(assembler, 100);
    assembler.observe({
      observedAtMs: 400,
      text: "keeps going until here. The next sentence starts",
    });
    expect(assembler.resolveCapture(firstCapture, "boundary")).toEqual({
      completeness: "complete",
      text: "This sentence keeps going until here.",
    });

    const secondCapture = requireCapture(assembler, 500);
    expect(secondCapture).toMatchObject({
      complete: false,
      text: "The next sentence starts",
    });
    assembler.observe({
      observedAtMs: 600,
      text: "The next sentence starts now.",
    });

    expect(assembler.resolveCapture(secondCapture, "boundary")).toEqual({
      completeness: "complete",
      text: "The next sentence starts now.",
    });
  });

  it("keeps the captured last sentence when a full snapshot grows from the front", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "Earlier context. This sentence" });
    const capture = requireCapture(assembler, 100);
    assembler.observe({
      observedAtMs: 200,
      text: "Earlier context. This sentence finishes here.",
    });

    expect(assembler.resolveCapture(capture, "boundary")).toEqual({
      completeness: "complete",
      text: "This sentence finishes here.",
    });
  });

  it("does not split common abbreviations or decimal numbers", () => {
    const assembler = new CaptionSentenceAssembler({ sentenceSegmenter: null });

    assembler.observe({
      observedAtMs: 0,
      text: "Dr. Smith measured 3.5 meters. Another sentence",
    });

    expect(assembler.beginCapture(100)).toMatchObject({
      complete: false,
      text: "Another sentence",
    });
  });

  it("recognizes ellipses with trailing quotes and keeps short overlaps literal", () => {
    const assembler = new CaptionSentenceAssembler({ sentenceSegmenter: null });

    assembler.observe({ observedAtMs: 0, text: "He paused…”" });
    expect(assembler.beginCapture(100)).toMatchObject({
      complete: true,
      text: "He paused…”",
    });

    assembler.clear();
    assembler.observe({ observedAtMs: 200, text: "We saw the cat" });
    assembler.observe({ observedAtMs: 300, text: "cat run away" });
    expect(assembler.beginCapture(400)?.text).toBe("We saw the cat cat run away");
  });

  it("starts a new sentence after a discontinuity or speaker marker", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "An unfinished earlier caption" });
    assembler.observe({ observedAtMs: 4_001, text: "A fresh caption" });
    expect(assembler.beginCapture(4_100)?.text).toBe("A fresh caption");

    assembler.clear();
    assembler.observe({ observedAtMs: 5_000, text: "The first speaker continues" });
    assembler.observe({ observedAtMs: 5_200, text: ">> A new speaker begins" });
    expect(assembler.beginCapture(5_300)?.text).toBe(">> A new speaker begins");
  });

  it("expires old observations and caps one sentence at the protocol limit", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "Old unfinished text" });
    assembler.observe({ observedAtMs: 20_001, text: "Fresh text" });
    expect(assembler.beginCapture(20_100)?.text).toBe("Fresh text");

    const legalText = "x".repeat(MAX_CONTEXT_LENGTH - 100);
    assembler.clear();
    assembler.observe({ observedAtMs: 30_000, text: legalText });
    const capture = requireCapture(assembler, 30_100);
    assembler.observe({
      observedAtMs: 30_200,
      text: `${"x".repeat(12)} ${"y".repeat(200)}`,
    });

    expect(assembler.resolveCapture(capture, "overflow")).toEqual({
      completeness: "best-effort",
      text: legalText,
    });
  });

  it("bounds the full rolling window even when every adjacent cue is recent", () => {
    const assembler = new CaptionSentenceAssembler();

    for (let index = 0; index <= 11; index += 1) {
      assembler.observe({ observedAtMs: index * 2_000, text: `rolling cue ${index}` });
    }

    expect(assembler.beginCapture(22_100)?.text).toBe("rolling cue 11");
  });

  it("expires hidden prefixes even when the latest rendered cue is a duplicate", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "The opening words" });
    assembler.observe({ observedAtMs: 2_000, text: "opening words keep going" });
    assembler.observe({ observedAtMs: 22_100, text: "opening words keep going" });

    expect(assembler.beginCapture(22_200)?.text).toBe("opening words keep going");
  });

  it("starts a fresh age window when observation moves to a new sentence", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "The first sentence ends." });
    assembler.observe({ observedAtMs: 18_000, text: "The second sentence starts" });
    assembler.observe({ observedAtMs: 21_900, text: "sentence starts and continues" });

    expect(assembler.beginCapture(22_000)?.text).toBe("The second sentence starts and continues");
  });

  it("uses the newest visible cue as the baseline after a captured overflow", () => {
    const assembler = new CaptionSentenceAssembler();
    const legalText = "x".repeat(MAX_CONTEXT_LENGTH - 100);

    assembler.observe({ observedAtMs: 0, text: legalText });
    const capture = requireCapture(assembler, 100);
    const newestCue = `${"x".repeat(12)} ${"y".repeat(200)}`;
    assembler.observe({ observedAtMs: 200, text: newestCue });
    expect(assembler.resolveCapture(capture, "overflow")?.text).toBe(legalText);

    expect(assembler.beginCapture(300)?.text).toBe(newestCue);
  });

  it("finishes the captured speaker before starting a new speaker", () => {
    const assembler = new CaptionSentenceAssembler();

    assembler.observe({ observedAtMs: 0, text: "The first speaker is unfinished" });
    const capture = requireCapture(assembler, 100);
    const update = assembler.observe({
      observedAtMs: 200,
      text: ">> The second speaker begins",
    });

    expect(update).toMatchObject({
      complete: true,
      text: "The first speaker is unfinished",
    });
    expect(assembler.resolveCapture(capture, "boundary")).toEqual({
      completeness: "complete",
      text: "The first speaker is unfinished",
    });
  });

  it("drops the oldest state after sixteen accepted observations", () => {
    const assembler = new CaptionSentenceAssembler();

    for (let index = 0; index < 17; index += 1) {
      assembler.observe({ observedAtMs: index * 100, text: `cue ${index}` });
    }

    expect(assembler.beginCapture(2_000)?.text).toBe("cue 16");
  });
});
