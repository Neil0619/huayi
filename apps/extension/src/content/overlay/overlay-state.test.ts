import { describe, expect, it } from "vitest";

import type { AnalysisDeltaEvent, AnalysisResult, AnalysisSectionEvent } from "@huayi/protocol";

import {
  OverlayStateMachine,
  reduceOverlayState,
  type ActionsOverlayState,
  type OverlayState,
} from "./overlay-state.js";

const actionsForWord: ActionsOverlayState = {
  anchorRect: { bottom: 20, height: 10, left: 10, right: 20, top: 10, width: 10 },
  selection: {
    context: "The investigation continues.",
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation continues.",
    wordbookContext: "The investigation continues.",
  },
  status: "actions",
};

const lexicalResult: AnalysisResult = {
  collocations: [
    { meaningZh: "刑事调查", text: "criminal investigation" },
    { meaningZh: "展开调查", text: "launch an investigation" },
  ],
  contextualMeaningZh: "调查",
  partOfSpeech: "noun",
  selectionKind: "word",
  similarTerms: [
    { meaningZh: "询问", partOfSpeech: "noun", text: "inquiry" },
    { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
    { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
  ],
  sourceText: "investigation",
  type: "translate-lexical",
};

function startWordAnalysis(): OverlayState {
  return reduceOverlayState(actionsForWord, {
    action: "translate",
    startedAt: 1,
    type: "START",
  });
}

function delta(
  sequence: number,
  value: string,
  section: AnalysisDeltaEvent["section"] = "contextual-meaning",
): AnalysisDeltaEvent {
  return {
    delta: value,
    requestId: "analysis-1",
    schemaVersion: 4,
    section,
    sequence,
    type: "analysis-delta",
  };
}

function section(
  sequence: number,
  payload: Pick<AnalysisSectionEvent, "section" | "value">,
): AnalysisSectionEvent {
  return {
    ...payload,
    requestId: "analysis-1",
    schemaVersion: 4,
    sequence,
    type: "analysis-section",
  } as AnalysisSectionEvent;
}

describe("reduceOverlayState", () => {
  it("starts wordbook checking independently and enters streaming on the first update", () => {
    let state = startWordAnalysis();

    expect(state).toMatchObject({
      status: "loading",
      wordbook: { availability: "checking", mutation: { status: "idle" } },
    });

    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: delta(0, "调"),
    });
    expect(state).toMatchObject({
      preview: { lastSequence: 0, sections: {}, text: { "contextual-meaning": "调" } },
      status: "streaming",
    });

    state = reduceOverlayState(state, {
      presence: "present",
      type: "RESOLVE_WORDBOOK_CHECK",
    });
    expect(state).toMatchObject({ wordbook: { availability: "present" } });
  });

  it("shares one contiguous sequence across text and typed sections", () => {
    let state = reduceOverlayState(startWordAnalysis(), {
      type: "APPEND_ANALYSIS_UPDATE",
      update: delta(0, "调"),
    });
    const afterFirst = state;

    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: section(0, { section: "part-of-speech", value: "noun" }),
    });
    expect(state).toBe(afterFirst);

    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: section(2, {
        section: "collocations",
        value: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
      }),
    });
    expect(state).toBe(afterFirst);

    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: section(1, { section: "part-of-speech", value: "noun" }),
    });
    expect(state).toMatchObject({
      preview: {
        lastSequence: 1,
        sections: { partOfSpeech: "noun" },
        text: { "contextual-meaning": "调" },
      },
    });

    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: section(2, {
        section: "collocations",
        value: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
      }),
    });
    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: delta(3, "查"),
    });
    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: section(4, { section: "part-of-speech", value: "verb" }),
    });
    expect(state).toMatchObject({
      preview: {
        lastSequence: 4,
        sections: {
          collocations: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
          partOfSpeech: "verb",
        },
        text: { "contextual-meaning": "调查" },
      },
    });
  });

  it.each([
    ["query before result", true, "present"],
    ["result before query", false, "absent"],
  ] as const)("preserves wordbook availability when %s", (_label, queryFirst, presence) => {
    let state = startWordAnalysis();
    if (queryFirst) {
      state = reduceOverlayState(state, { presence, type: "RESOLVE_WORDBOOK_CHECK" });
    }

    state = reduceOverlayState(state, { result: lexicalResult, type: "RESOLVE" });
    expect(state).toMatchObject({
      status: "result",
      wordbook: { availability: queryFirst ? presence : "checking" },
    });

    if (!queryFirst) {
      state = reduceOverlayState(state, { presence, type: "RESOLVE_WORDBOOK_CHECK" });
      expect(state).toMatchObject({
        status: "result",
        wordbook: { availability: presence },
      });
    }
  });

  it("turns a passive query error into unknown without rejecting analysis", () => {
    const state = reduceOverlayState(startWordAnalysis(), {
      type: "REJECT_WORDBOOK_CHECK",
    });

    expect(state).toMatchObject({
      status: "loading",
      wordbook: { availability: "unknown", mutation: { status: "idle" } },
    });
  });

  it("starts an add while checking and ignores late status while saving or successful", () => {
    let state = reduceOverlayState(startWordAnalysis(), { result: lexicalResult, type: "RESOLVE" });
    state = reduceOverlayState(state, { type: "START_WORDBOOK" });
    expect(state).toMatchObject({
      status: "result",
      wordbook: { availability: "checking", mutation: { status: "saving" } },
    });

    const saving = state;
    state = reduceOverlayState(state, {
      presence: "present",
      type: "RESOLVE_WORDBOOK_CHECK",
    });
    expect(state).toBe(saving);

    state = reduceOverlayState(state, { outcome: "already-exists", type: "RESOLVE_WORDBOOK" });
    expect(state).toMatchObject({ wordbook: { mutation: { status: "success" } } });
    const success = state;
    state = reduceOverlayState(state, {
      presence: "absent",
      type: "RESOLVE_WORDBOOK_CHECK",
    });
    expect(state).toBe(success);
  });

  it("keeps an explicit add error inline on the complete result", () => {
    let state = reduceOverlayState(startWordAnalysis(), { result: lexicalResult, type: "RESOLVE" });
    state = reduceOverlayState(state, { type: "START_WORDBOOK" });
    state = reduceOverlayState(state, {
      error: { code: "NETWORK_ERROR", message: "网络连接失败。", retryable: true },
      type: "REJECT_WORDBOOK",
    });

    expect(state).toMatchObject({
      result: lexicalResult,
      status: "result",
      wordbook: { mutation: { error: { code: "NETWORK_ERROR" }, status: "error" } },
    });
  });

  it("preserves a partial preview on error and resets it with a fresh wordbook check on retry", () => {
    let state = reduceOverlayState(startWordAnalysis(), {
      type: "APPEND_ANALYSIS_UPDATE",
      update: delta(0, "部分译文", "translation"),
    });
    state = reduceOverlayState(state, {
      type: "APPEND_ANALYSIS_UPDATE",
      update: section(1, { section: "part-of-speech", value: "number" }),
    });
    state = reduceOverlayState(state, {
      error: { code: "TIMEOUT", message: "处理超时，请重试。", retryable: true },
      type: "REJECT",
    });
    expect(state).toMatchObject({
      preview: {
        lastSequence: 1,
        sections: { partOfSpeech: "number" },
        text: { translation: "部分译文" },
      },
      status: "error",
    });

    state = reduceOverlayState(state, { startedAt: 2, type: "RETRY" });
    expect(state).toMatchObject({
      startedAt: 2,
      status: "loading",
      wordbook: { availability: "checking", mutation: { status: "idle" } },
    });
    expect("preview" in state).toBe(false);
  });
});

describe("OverlayStateMachine", () => {
  it("stores positions only while visible and ignores late results after close", () => {
    const machine = new OverlayStateMachine();
    machine.dispatch({ position: { left: 10, top: 20 }, type: "MOVE" });
    expect(machine.state).toEqual({ status: "idle" });

    machine.dispatch({ ...actionsForWord, type: "SHOW_ACTIONS" });
    machine.dispatch({ position: { left: 10, top: 20 }, type: "MOVE" });
    expect(machine.state).toMatchObject({ position: { left: 10, top: 20 } });

    machine.dispatch({ type: "CLOSE" });
    const closedState = machine.state;
    machine.dispatch({ result: lexicalResult, type: "RESOLVE" });
    expect(machine.state).toBe(closedState);
  });
});
