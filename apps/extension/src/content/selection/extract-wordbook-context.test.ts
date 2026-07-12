import { beforeEach, describe, expect, it } from "vitest";

import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { extractWordbookContext } from "./extract-wordbook-context.js";

function rangeForText(node: Text, selectedText: string, occurrence = 0): Range {
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = node.data.indexOf(selectedText, from);
    from = start + selectedText.length;
  }
  if (start < 0) {
    throw new Error("Selected text was not found in the fixture.");
  }
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + selectedText.length);
  return range;
}

describe("extractWordbookContext", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("extracts the sentence around a word nested inside inline elements", () => {
    const paragraph = document.createElement("p");
    paragraph.append("He opened ");
    const strong = document.createElement("strong");
    strong.textContent = "the investigation";
    paragraph.append(strong, " carefully. Another sentence followed.");
    document.body.append(paragraph);
    const text = strong.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected nested text fixture.");
    }

    expect(extractWordbookContext(rangeForText(text, "investigation"), "investigation")).toBe(
      "He opened the investigation carefully.",
    );
  });

  it("folds a br element into sentence whitespace without losing Range offsets", () => {
    const paragraph = document.createElement("p");
    paragraph.append("The ");
    const strong = document.createElement("strong");
    strong.textContent = "investigation";
    paragraph.append(strong, document.createElement("br"), "continued carefully.");
    document.body.append(paragraph);
    const text = strong.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected nested text fixture.");
    }

    expect(extractWordbookContext(rangeForText(text, "investigation"), "investigation")).toBe(
      "The investigation continued carefully.",
    );
  });

  it("uses the selected occurrence when a word appears in multiple sentences", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began. Later, the investigation ended.";
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }

    expect(extractWordbookContext(rangeForText(text, "investigation", 1), "investigation")).toBe(
      "Later, the investigation ended.",
    );
  });

  it("keeps abbreviations and closing quotes in the target sentence", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = 'Dr. Smith called it "an investigation." Then he left.';
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }

    expect(extractWordbookContext(rangeForText(text, "investigation"), "investigation")).toBe(
      'Dr. Smith called it "an investigation."',
    );
  });

  it("keeps abbreviations when Intl.Segmenter is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
    if (descriptor === undefined) {
      throw new Error("Intl.Segmenter descriptor is unavailable.");
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = "Dr. Smith began the investigation. Then he left.";
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }

    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    try {
      expect(extractWordbookContext(rangeForText(text, "investigation"), "investigation")).toBe(
        "Dr. Smith began the investigation.",
      );
    } finally {
      Object.defineProperty(Intl, "Segmenter", descriptor);
    }
  });

  it("uses the whole normalized block when it has no terminal punctuation", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "A\tcareful\n investigation remains underway";
    document.body.append(paragraph);
    const text = paragraph.lastChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }

    expect(extractWordbookContext(rangeForText(text, "investigation"), "investigation")).toBe(
      "A careful investigation remains underway",
    );
  });

  it("crops an oversized sentence around the selected occurrence", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = `${"a".repeat(1_500)} investigation ${"b".repeat(1_500)}.`;
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }

    const context = extractWordbookContext(rangeForText(text, "investigation"), "investigation");
    expect(context).toHaveLength(MAX_CONTEXT_LENGTH);
    expect(context).toContain("investigation");
  });

  it("falls back to the selected word for mixed Han context", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "这是 investigation 的语境。";
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }

    expect(extractWordbookContext(rangeForText(text, "investigation"), "investigation")).toBe(
      "investigation",
    );
  });
});
