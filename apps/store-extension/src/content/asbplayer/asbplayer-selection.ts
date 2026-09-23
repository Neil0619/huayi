import { normalizeSelectionText } from "@huayi/store-domain";
import { readStoreSelection } from "../selection/read-selection.js";
import type { LocalSentence } from "../subtitles/local-subtitles.js";
export function readAsbplayerSelection(
  doc: Document,
  english: HTMLElement | null,
  sentences: readonly LocalSentence[],
) {
  if (!english) return null;
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0),
    text = range.startContainer;
  if (
    !(text instanceof Text) ||
    text !== range.endContainer ||
    range.startOffset >= range.endOffset
  )
    return null;
  const block = text.parentElement;
  if (!block || block.childNodes.length !== 1 || !english.contains(block)) return null;
  const sentence = sentences.find((s) => String(s.id) === block.dataset.huayiAsbplayerEnglish);
  if (!sentence || sentence.text !== text.data) return null;
  const reading = readStoreSelection(selection);
  if (!reading || reading.context !== text.data) return null;
  const complete = sentence.complete && reading.selection === normalizeSelectionText(sentence.text);
  return {
    range,
    reading: {
      ...reading,
      sentenceContext:
        reading.selectionKind === "word" || reading.selectionKind === "phrase"
          ? sentence.text
          : null,
      ...(complete && reading.selectionKind !== "word"
        ? {
            boundaryEvidence: { kind: "asbplayer-subtitle-sentence" as const },
            selectionKind: "sentence" as const,
          }
        : {}),
    },
  };
}
