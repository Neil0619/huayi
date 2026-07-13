import { beforeEach, describe, expect, it } from "vitest";

import { MAX_CONTEXT_LENGTH } from "@huayi/protocol";

import { extractSentenceContext } from "./extract-sentence-context.js";

function textNode(element: Element): Text {
  const node = element.firstChild;
  if (!(node instanceof Text)) {
    throw new Error("Expected a text node fixture.");
  }
  return node;
}

function occurrenceStart(value: string, selectedText: string, occurrence = 0): number {
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = value.indexOf(selectedText, from);
    if (start < 0) {
      throw new Error("Selected text was not found in the fixture.");
    }
    from = start + selectedText.length;
  }
  return start;
}

function rangeForText(node: Text, selectedText: string, occurrence = 0): Range {
  const start = occurrenceStart(node.data, selectedText, occurrence);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + selectedText.length);
  return range;
}

describe("extractSentenceContext", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("extracts the exact sentence around a word nested inside inline elements", () => {
    const paragraph = document.createElement("p");
    paragraph.append("The ");
    const strong = document.createElement("strong");
    strong.textContent = "victims";
    paragraph.append(strong, " were taken to safety. Another sentence followed.");
    document.body.append(paragraph);

    expect(extractSentenceContext(rangeForText(textNode(strong), "victims"), "victims")).toBe(
      "The victims were taken to safety.",
    );
  });

  it("uses the selected occurrence when a word appears in multiple sentences", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "The victims were identified. Later, the victims were taken to safety.";
    document.body.append(paragraph);
    const secondRange = rangeForText(textNode(paragraph), "victims", 1);

    expect(extractSentenceContext(secondRange, "victims")).toBe(
      "Later, the victims were taken to safety.",
    );
  });

  it("extracts a phrase whose Range crosses text nodes", () => {
    const paragraph = document.createElement("p");
    paragraph.append("The ");
    const strong = document.createElement("strong");
    strong.textContent = "sustained";
    const emphasis = document.createElement("em");
    emphasis.textContent = "heatwave";
    paragraph.append(strong, " ", emphasis, " affected the region. Conditions later improved.");
    document.body.append(paragraph);

    const startNode = textNode(strong);
    const endNode = textNode(emphasis);
    const range = document.createRange();
    range.setStart(startNode, 0);
    range.setEnd(endNode, endNode.length);

    expect(extractSentenceContext(range, "sustained heatwave")).toBe(
      "The sustained heatwave affected the region.",
    );
  });

  it("keeps an abbreviation attached to its sentence", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Dr. Smith helped the victims. Then he left.";
    document.body.append(paragraph);

    expect(extractSentenceContext(rangeForText(textNode(paragraph), "victims"), "victims")).toBe(
      "Dr. Smith helped the victims.",
    );
  });

  it("keeps abbreviations when Intl.Segmenter is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
    if (descriptor === undefined) {
      throw new Error("Intl.Segmenter descriptor is unavailable.");
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = "Dr. Smith helped the victims. Then he left.";
    document.body.append(paragraph);

    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    try {
      expect(extractSentenceContext(rangeForText(textNode(paragraph), "victims"), "victims")).toBe(
        "Dr. Smith helped the victims.",
      );
    } finally {
      Object.defineProperty(Intl, "Segmenter", descriptor);
    }
  });

  it("keeps closing quotes and sentence punctuation", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = 'She said, "The victims are safe." Then she left.';
    document.body.append(paragraph);

    expect(extractSentenceContext(rangeForText(textNode(paragraph), "victims"), "victims")).toBe(
      'She said, "The victims are safe."',
    );
  });

  it("uses the normalized block when it has no terminal punctuation", () => {
    const paragraph = document.createElement("p");
    paragraph.append("The victims", document.createElement("br"), "remain safe");
    document.body.append(paragraph);

    expect(extractSentenceContext(rangeForText(textNode(paragraph), "victims"), "victims")).toBe(
      "The victims remain safe",
    );
  });

  it("crops an oversized sentence around the actual selected occurrence", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent =
      `victims ${"alpha ".repeat(500)}` + `selected victims marker ${"omega ".repeat(500)}`;
    document.body.append(paragraph);

    const context = extractSentenceContext(
      rangeForText(textNode(paragraph), "victims", 1),
      "victims",
    );

    expect(context).toHaveLength(MAX_CONTEXT_LENGTH);
    expect(context).toContain("selected victims marker");
    const selectedIndex = context?.indexOf("selected victims marker") ?? -1;
    expect(selectedIndex).toBeGreaterThan(900);
    expect(selectedIndex).toBeLessThan(1_100);
  });

  it("returns null instead of the selected token for mixed Han context", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "这是 victims 的语境。";
    document.body.append(paragraph);

    expect(
      extractSentenceContext(rangeForText(textNode(paragraph), "victims"), "victims"),
    ).toBeNull();
  });

  it("returns null when no semantic block can be located", () => {
    const span = document.createElement("span");
    span.textContent = "victims";
    document.body.append(span);

    expect(extractSentenceContext(rangeForText(textNode(span), "victims"), "victims")).toBeNull();
  });

  it("returns null when the selected text cannot be located at the Range", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "The victims were taken to safety.";
    document.body.append(paragraph);

    expect(
      extractSentenceContext(rangeForText(textNode(paragraph), "victims"), "survivors"),
    ).toBeNull();
  });
});
