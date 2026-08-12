import { describe, expect, it } from "vitest";

import {
  canonicalKeyForContent,
  confirmCandidate,
  exactDuplicateIdentity,
  mergeLearningItems,
  mergeWordEntries,
  normalizeCanonicalText,
  normalizeHeadword,
} from "./index.js";

describe("canonical identity", () => {
  it("normalizes NFKC, whitespace, case, and curved quotes", () => {
    expect(normalizeCanonicalText("  ＴＯ\tBE “FRANK”  ")).toBe('to be "frank"');
    expect(normalizeHeadword("  CAFÉ\tD’ART  ")).toBe("café d'art");
  });

  it("uses type-specific canonical keys and never compares across types", () => {
    const expression = {
      meaningZh: "坦率地说",
      text: "To be frank",
      type: "expression" as const,
      usageZh: "引出直接意见。",
    };
    const pattern = {
      functionZh: "表达原因",
      slots: [
        { descriptionZh: "原因", name: "reason" },
        { descriptionZh: "结果", name: "result" },
      ],
      template: "Because {reason}, {result}",
      type: "sentence_pattern" as const,
      usageZh: "连接原因和结果。",
    };
    expect(canonicalKeyForContent(expression)).toBe("to be frank");
    expect(canonicalKeyForContent(pattern)).toBe("because {slot1}, {slot2}");
    expect(exactDuplicateIdentity(expression)).toBe("expression:to be frank");
    expect(exactDuplicateIdentity(pattern)).toBe("sentence-pattern:because {slot1}, {slot2}");
  });
});

describe("candidate confirmation and merge", () => {
  const source = {
    analysisId: "analysis-1",
    sentenceId: "s1",
    sourceText: "To be frank, this works.",
    sourceTitle: "Notes",
    sourceType: "manual" as const,
  };

  it("routes words to WordEntry contexts and expressions to LearningItem snapshots", () => {
    const word = confirmCandidate(
      {
        id: "candidate-word",
        ordinal: 0,
        payload: {
          contextualMeaningZh: "有效",
          headword: "works",
          type: "word",
        },
        sentenceId: "s1",
        type: "word",
      },
      source,
      "2026-08-12T10:00:00.000Z",
    );
    expect(word).toMatchObject({
      type: "word",
      word: {
        canonicalKey: "works",
        contexts: [{ contextualMeaningZh: "有效", sourceText: source.sourceText }],
        headword: "works",
      },
    });

    const expression = confirmCandidate(
      {
        id: "candidate-expression",
        ordinal: 1,
        payload: {
          meaningZh: "坦率地说",
          text: "to be frank",
          type: "expression",
          usageZh: "用于直接表达个人意见。",
        },
        sentenceId: "s1",
        type: "expression",
      },
      source,
      "2026-08-12T10:00:00.000Z",
    );
    expect(expression).toMatchObject({
      item: {
        canonicalKey: "to be frank",
        sourceExamples: [{ analysisId: "analysis-1", sourceText: source.sourceText }],
        type: "expression",
      },
      type: "learning-item",
    });
  });

  it("merges additive data without overwriting user core fields", () => {
    const target = {
      canonicalKey: "to be frank",
      content: {
        meaningZh: "说实话",
        text: "to be frank",
        type: "expression" as const,
        usageZh: "用户编辑过的说明。",
      },
      sourceExamples: [{ ...source, id: "source-1" }],
      systemAttributes: ["discourse-marker"],
      tags: ["writing"],
      type: "expression" as const,
    };
    const incoming = {
      ...target,
      content: { ...target.content, meaningZh: "坦率地说", usageZh: "模型说明" },
      sourceExamples: [{ ...source, id: "source-2", sourceText: "To be frank, no." }],
      systemAttributes: ["spoken"],
      tags: ["conversation"],
    };
    expect(mergeLearningItems(target, incoming)).toMatchObject({
      content: target.content,
      sourceExamples: [target.sourceExamples[0], incoming.sourceExamples[0]],
      systemAttributes: ["discourse-marker", "spoken"],
      tags: ["writing", "conversation"],
    });

    const mergedWord = mergeWordEntries(
      { canonicalKey: "work", contexts: [], headword: "Work", notes: "My note" },
      {
        canonicalKey: "work",
        contexts: [
          {
            contextualMeaningZh: "奏效",
            id: "context-1",
            observedAt: "2026-08-12T10:00:00.000Z",
            sourceText: "It works.",
            sourceType: "manual" as const,
          },
        ],
        headword: "work",
        notes: "Generated note",
      },
    );
    expect(mergedWord.notes).toBe("My note");
    expect(mergedWord.headword).toBe("Work");
    expect(mergedWord.contexts).toHaveLength(1);
  });

  it("deduplicates repeated additive values within the incoming merge batch", () => {
    const target = {
      canonicalKey: "to be frank",
      content: {
        meaningZh: "说实话",
        text: "to be frank",
        type: "expression" as const,
        usageZh: "用户编辑过的说明。",
      },
      sourceExamples: [],
      systemAttributes: [],
      tags: [],
      type: "expression" as const,
    };
    const repeatedSource = { ...source, id: "source-repeated" };
    const merged = mergeLearningItems(target, {
      ...target,
      sourceExamples: [repeatedSource, repeatedSource],
      systemAttributes: ["spoken", "spoken"],
      tags: ["conversation", "conversation"],
    });

    expect(merged.sourceExamples).toEqual([repeatedSource]);
    expect(merged.systemAttributes).toEqual(["spoken"]);
    expect(merged.tags).toEqual(["conversation"]);
  });
});
