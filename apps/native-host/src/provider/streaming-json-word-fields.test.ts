import { describe, expect, it } from "vitest";

import { StreamingJsonFieldExtractor } from "./streaming-json-fields.js";

describe("StreamingJsonFieldExtractor word results", () => {
  it("streams word dictionary fields in the requested display order", () => {
    const extractor = new StreamingJsonFieldExtractor({
      resultType: "translate-word",
      sentenceContext: null,
    });

    expect(
      extractor.push(
        '{"pronunciation":{"uk":"/ˈprɪnsəpəl/","us":null},' +
          '"contextualSense":{"meaningZh":"主要的","partOfSpeech":"adjective"},' +
          '"dictionaryForm":"principal",' +
          '"commonMeanings":[{"meaningsZh":["主要的"],"partOfSpeech":"adjective"}],' +
          '"commonPhrases":[{"meaningZh":"校长","text":"school principal"}],' +
          '"confusableWords":[{"distinctionZh":"principle 表示原则。",' +
          '"meaningZh":"原则","partOfSpeech":"noun","text":"principle"}]}',
      ),
    ).toEqual([
      { section: "pronunciation", type: "analysis-section", value: { uk: "/ˈprɪnsəpəl/" } },
      {
        section: "contextual-sense",
        type: "analysis-section",
        value: { meaningZh: "主要的", partOfSpeech: "adjective" },
      },
      {
        section: "common-meanings",
        type: "analysis-section",
        value: [{ meaningsZh: ["主要的"], partOfSpeech: "adjective" }],
      },
      {
        section: "common-phrases",
        type: "analysis-section",
        value: [{ meaningZh: "校长", text: "school principal" }],
      },
      {
        section: "confusable-words",
        type: "analysis-section",
        value: [
          {
            distinctionZh: "principle 表示原则。",
            meaningZh: "原则",
            partOfSpeech: "noun",
            text: "principle",
          },
        ],
      },
    ]);
    expect(() => extractor.finish()).not.toThrow();
  });

  it("streams word explanation prose and structured comparisons separately", () => {
    const extractor = new StreamingJsonFieldExtractor({
      resultType: "explain-word",
      sentenceContext: null,
    });

    expect(
      extractor.push(
        '{"contextualAnalysisZh":"此处表示承担责任。",' +
          '"wordForm":{"baseForm":"accountable","formTypeZh":"形容词原形",' +
          '"sentenceRoleZh":"表语"},"wordFormationZh":null,' +
          '"usageNotes":[{"titleZh":"搭配","descriptionZh":"常与 for 连用。"}],' +
          '"synonyms":[{"distinctionZh":"responsible 更通用。",' +
          '"meaningZh":"负责的","partOfSpeech":"adjective","text":"responsible"}]}',
      ),
    ).toEqual([
      { delta: "此处表示承担责任。", section: "contextual-analysis", type: "analysis-delta" },
      {
        section: "word-form",
        type: "analysis-section",
        value: {
          baseForm: "accountable",
          formTypeZh: "形容词原形",
          sentenceRoleZh: "表语",
        },
      },
      {
        section: "usage-notes",
        type: "analysis-section",
        value: [{ descriptionZh: "常与 for 连用。", titleZh: "搭配" }],
      },
      {
        section: "synonym-comparisons",
        type: "analysis-section",
        value: [
          {
            distinctionZh: "responsible 更通用。",
            meaningZh: "负责的",
            partOfSpeech: "adjective",
            text: "responsible",
          },
        ],
      },
    ]);
    expect(() => extractor.finish()).not.toThrow();
  });
});
