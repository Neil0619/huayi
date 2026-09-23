import { afterEach, describe, expect, it } from "vitest";
import { readAsbplayerSelection } from "./asbplayer-selection.js";
const sentence = {
  id: 1,
  startMs: 0,
  endMs: 1000,
  text: "This is a complete sentence.",
  complete: true,
};
function fixture() {
  const root = document.createElement("div"),
    block = document.createElement("div");
  block.dataset.huayiAsbplayerEnglish = "1";
  block.textContent = sentence.text;
  root.append(block);
  document.body.append(root);
  return {
    root,
    block,
    choose: (start: number, end: number) => {
      const range = document.createRange();
      range.setStart(block.firstChild as Text, start);
      range.setEnd(block.firstChild as Text, end);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    },
  };
}
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});
describe("asbplayer learning selection", () => {
  it("keeps lexical context and assigns evidence only to a genuinely complete block", () => {
    const h = fixture();
    h.choose(0, 4);
    expect(readAsbplayerSelection(document, h.root, [sentence])?.reading).toMatchObject({
      selection: "This",
      selectionKind: "word",
      sentenceContext: sentence.text,
    });
    h.choose(0, sentence.text.length);
    expect(readAsbplayerSelection(document, h.root, [sentence])?.reading).toMatchObject({
      selectionKind: "sentence",
      boundaryEvidence: { kind: "asbplayer-subtitle-sentence" },
    });
    expect(
      readAsbplayerSelection(document, h.root, [{ ...sentence, complete: false }])?.reading
        .boundaryEvidence,
    ).toEqual({ kind: "local-rules" });
  });
  it("rejects stale mutated text, outside text and cross-block selections", () => {
    const h = fixture();
    h.choose(0, 4);
    if (h.block.firstChild) h.block.firstChild.textContent = "Forged text";
    expect(readAsbplayerSelection(document, h.root, [sentence])).toBeNull();
    h.block.textContent = sentence.text;
    h.choose(0, 4);
    expect(readAsbplayerSelection(document, document.createElement("div"), [sentence])).toBeNull();
    const other = document.createElement("div");
    other.textContent = "other";
    h.root.append(other);
    const range = document.createRange();
    range.setStart(h.block.firstChild as Text, 0);
    range.setEnd(other.firstChild as Text, 5);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    expect(readAsbplayerSelection(document, h.root, [sentence])).toBeNull();
  });
});
