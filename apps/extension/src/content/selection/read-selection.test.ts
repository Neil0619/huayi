import { beforeEach, describe, expect, it } from "vitest";

import { MAX_SELECTION_LENGTH } from "@huayi/protocol";

import { readSelection } from "./read-selection.js";

function selectContents(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error("Selection API is unavailable.");
  }

  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("readSelection", () => {
  beforeEach(() => {
    document.body.textContent = "";
    window.getSelection()?.removeAllRanges();
  });

  it("returns normalized English text, context, kind, and a cloned range", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "sustained   heatwave";
    document.body.append(paragraph);

    const reading = readSelection(selectContents(paragraph));

    expect(reading?.selection).toBe("sustained heatwave");
    expect(reading?.context).toBe("sustained heatwave");
    expect(reading?.selectionKind).toBe("phrase");
    expect(reading?.range).toBeInstanceOf(Range);
  });

  it("ignores empty, Chinese, and oversized selections", () => {
    const paragraph = document.createElement("p");
    document.body.append(paragraph);

    paragraph.textContent = "   ";
    expect(readSelection(selectContents(paragraph))).toBeNull();

    paragraph.textContent = "这是中文";
    expect(readSelection(selectContents(paragraph))).toBeNull();

    paragraph.textContent = "a".repeat(MAX_SELECTION_LENGTH + 1);
    expect(readSelection(selectContents(paragraph))).toBeNull();
  });

  it("ignores form controls and editable regions", () => {
    const textarea = document.createElement("textarea");
    textarea.textContent = "investigation";
    document.body.append(textarea);
    expect(readSelection(selectContents(textarea))).toBeNull();

    const select = document.createElement("select");
    const option = document.createElement("option");
    option.textContent = "investigation";
    select.append(option);
    document.body.append(select);
    expect(readSelection(selectContents(option))).toBeNull();

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.textContent = "investigation";
    document.body.append(editor);
    expect(readSelection(selectContents(editor))).toBeNull();
  });
});
