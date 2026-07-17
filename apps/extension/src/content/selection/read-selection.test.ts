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
    expect(reading?.sentenceContext).toBe("sustained heatwave");
    expect(reading?.wordbookContext).toBeNull();
    expect(reading?.range).toBeInstanceOf(Range);
  });

  it("uses the exact word sentence for analysis and as the wordbook alias", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began. Later work continued.";
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }
    const range = document.createRange();
    const start = text.data.indexOf("investigation");
    range.setStart(text, start);
    range.setEnd(text, start + "investigation".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(readSelection(selection)).toMatchObject({
      sentenceContext: "The investigation began.",
      wordbookContext: "The investigation began.",
    });
  });

  it("returns null lexical context instead of the selected token for mixed Han text", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "这是 investigation 的语境。";
    document.body.append(paragraph);
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }
    const range = document.createRange();
    const start = text.data.indexOf("investigation");
    range.setStart(text, start);
    range.setEnd(text, start + "investigation".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(readSelection(selection)).toMatchObject({
      context: "investigation",
      sentenceContext: null,
      wordbookContext: null,
    });
  });

  it("does not send a mixed Han technical block when selecting hatch inside hatch-pet", () => {
    const paragraph = document.createElement("p");
    const code = document.createElement("code");
    code.textContent = "hatch-pet";
    paragraph.append(code, " skill 负责迁移 schema");
    document.body.append(paragraph);
    const text = code.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected text fixture.");
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "hatch".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(readSelection(selection)).toMatchObject({
      context: "hatch",
      selection: "hatch",
      selectionKind: "word",
      sentenceContext: null,
      wordbookContext: null,
    });
  });

  it("does not extract lexical sentence context for sentence selections", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "The investigation began.";
    document.body.append(paragraph);

    expect(readSelection(selectContents(paragraph))).toMatchObject({
      selectionKind: "sentence",
      sentenceContext: null,
      wordbookContext: null,
    });
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
