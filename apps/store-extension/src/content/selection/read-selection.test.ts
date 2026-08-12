import { beforeEach, describe, expect, it } from "vitest";

import { readStoreSelection } from "./read-selection.js";

function selectText(element: Element, text: string): Selection {
  const node = element.firstChild;
  if (!(node instanceof Text)) throw new Error("Expected text fixture.");
  const start = node.data.indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const selection = window.getSelection();
  if (selection === null) throw new Error("Selection API is unavailable.");
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("Store page selection", () => {
  beforeEach(() => {
    document.body.textContent = "";
    window.getSelection()?.removeAllRanges();
  });

  it.each([
    ["investigation", "word"],
    ["early stages", "phrase"],
    ["The investigation was still in its early stages.", "sentence"],
  ] as const)("reads a bounded English %s selection", (text, kind) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = `Before. ${text} After.`;
    document.body.append(paragraph);

    expect(readStoreSelection(selectText(paragraph, text))).toMatchObject({
      context: `Before. ${text} After.`,
      selection: text,
      selectionKind: kind,
      sentenceContext: kind === "sentence" ? null : `Before. ${text} After.`,
    });
  });

  it("extracts the exact containing sentence for a lexical selection", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Earlier work ended. The investigation began slowly. Later work.";
    document.body.append(paragraph);

    expect(readStoreSelection(selectText(paragraph, "investigation"))).toMatchObject({
      context: paragraph.textContent,
      sentenceContext: "The investigation began slowly.",
    });
  });

  it("keeps abbreviations and normalized leading whitespace in the containing sentence", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Dr. Smith   investigated the evidence. Later work followed.";
    document.body.append(paragraph);

    expect(readStoreSelection(selectText(paragraph, "evidence"))).toMatchObject({
      sentenceContext: "Dr. Smith investigated the evidence.",
    });
  });

  it("ignores editable, mixed-language, collapsed, and oversized selections", () => {
    const input = document.createElement("div");
    input.setAttribute("contenteditable", "true");
    input.textContent = "editable text";
    document.body.append(input);
    expect(readStoreSelection(selectText(input, "editable"))).toBeNull();

    const mixed = document.createElement("p");
    mixed.textContent = "English 中文";
    document.body.append(mixed);
    expect(readStoreSelection(selectText(mixed, mixed.textContent))).toBeNull();

    const long = document.createElement("p");
    long.textContent = "a".repeat(2_001);
    document.body.append(long);
    expect(readStoreSelection(selectText(long, long.textContent))).toBeNull();

    window.getSelection()?.removeAllRanges();
    expect(readStoreSelection()).toBeNull();
  });
});
