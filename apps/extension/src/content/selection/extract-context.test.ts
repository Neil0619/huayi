import { beforeEach, describe, expect, it } from "vitest";

import {
  extractContext,
  findSemanticBlock,
  trimContextAroundSelection,
} from "./extract-context.js";

function createRangeFor(element: Element, selectedText: string, occurrence = 0) {
  const textNode = element.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error("Expected a text node fixture.");
  }

  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = textNode.data.indexOf(selectedText, from);
    if (start < 0) {
      throw new Error("Selected text was not found in the fixture.");
    }
    from = start + selectedText.length;
  }
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + selectedText.length);
  return range;
}

describe("findSemanticBlock", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("returns the nearest supported semantic block", () => {
    const article = document.createElement("article");
    const paragraph = document.createElement("p");
    const span = document.createElement("span");
    span.textContent = "The investigation is ongoing.";
    paragraph.append(span);
    article.append(paragraph);
    document.body.append(article);

    expect(findSemanticBlock(span.firstChild)).toBe(paragraph);
  });
});

describe("trimContextAroundSelection", () => {
  it("keeps the selection inside a centered length-limited window", () => {
    const selection = "investigation";
    const context = `${"a".repeat(150)} ${selection} ${"b".repeat(150)}`;
    const trimmed = trimContextAroundSelection(context, selection, 100);

    expect(trimmed).toHaveLength(100);
    expect(trimmed).toContain(selection);
  });
});

describe("extractContext", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it("extracts normalized text from the containing paragraph", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "He said the   investigation was in its early stages.";
    document.body.append(paragraph);
    const range = createRangeFor(paragraph, "investigation");

    expect(extractContext(range, "investigation")).toBe(
      "He said the investigation was in its early stages.",
    );
  });

  it("limits extracted context to 2,000 characters without dropping the selection", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = `${"a".repeat(1_500)} investigation ${"b".repeat(1_500)}`;
    document.body.append(paragraph);
    const range = createRangeFor(paragraph, "investigation");

    const context = extractContext(range, "investigation");

    expect(context).toHaveLength(2_000);
    expect(context).toContain("investigation");
  });

  it("centers a long repeated context on the occurrence selected by the Range", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent =
      `victims ${"alpha ".repeat(500)}` + `selected victims marker ${"omega ".repeat(500)}`;
    document.body.append(paragraph);
    const range = createRangeFor(paragraph, "victims", 1);

    const context = extractContext(range, "victims");

    expect(context).toHaveLength(2_000);
    expect(context).toContain("selected victims marker");
    const selectedIndex = context.indexOf("selected victims marker");
    expect(selectedIndex).toBeGreaterThan(900);
    expect(selectedIndex).toBeLessThan(1_100);
  });
});
