import type { AnalyzeAction, SelectionKind } from "@huayi/protocol";

export const COMPARISON_CASES = [
  {
    action: "translate",
    context: "The investigation remains at an early stage.",
    id: "word-investigation",
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation remains at an early stage.",
  },
  {
    action: "explain",
    context: "She sustained the effort throughout the inquiry.",
    id: "word-sustained",
    selection: "sustained",
    selectionKind: "word",
    sentenceContext: "She sustained the effort throughout the inquiry.",
  },
  {
    action: "translate",
    context: "The victims were taken to safety.",
    id: "word-victims",
    selection: "victims",
    selectionKind: "word",
    sentenceContext: "The victims were taken to safety.",
  },
  {
    action: "explain",
    context: "Officials promised to hold those responsible accountable.",
    id: "word-accountable",
    selection: "accountable",
    selectionKind: "word",
    sentenceContext: "Officials promised to hold those responsible accountable.",
  },
  {
    action: "explain",
    context: "Four witnesses came forward.",
    id: "word-four",
    selection: "Four",
    selectionKind: "word",
    sentenceContext: "Four witnesses came forward.",
  },
  {
    action: "translate",
    context: "The investigation is still in the early stages.",
    id: "phrase",
    selection: "in the early stages",
    selectionKind: "phrase",
    sentenceContext: "The investigation is still in the early stages.",
  },
  {
    action: "explain",
    context: "He urged anyone to come forward.",
    id: "sentence",
    selection: "He urged anyone to come forward.",
    selectionKind: "sentence",
    sentenceContext: null,
  },
  {
    action: "translate",
    context: "First sentence. Second sentence.",
    id: "paragraph",
    selection: "First sentence. Second sentence.",
    selectionKind: "paragraph",
    sentenceContext: null,
  },
] as const satisfies readonly {
  action: AnalyzeAction;
  context: string;
  id: string;
  selection: string;
  selectionKind: SelectionKind;
  sentenceContext: string | null;
}[];

export type ComparisonCase = (typeof COMPARISON_CASES)[number];
