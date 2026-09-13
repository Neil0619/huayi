/** A complete private witness example; each substitution is checked in the adjacent test. */
export const structuredAnalysisPatternExample = {
  sourceText: "The delay kept us from leaving early.",
  candidate: {
    type: "sentence_pattern",
    template: "{cause} kept {person} from {action}.",
    slots: [
      { name: "cause", descriptionZh: "造成阻碍的事物" },
      { name: "person", descriptionZh: "受到阻碍的人" },
      { name: "action", descriptionZh: "没有完成的动作，使用动名词短语" },
    ],
    sourceValues: [
      { name: "cause", text: "The delay" },
      { name: "person", text: "us" },
      { name: "action", text: "leaving early" },
    ],
    functionZh: "说明某事阻碍某人做某事。",
    usageZh: "kept 是过去式，from 后用动名词短语。",
    learningAdvice: {
      priority: 1,
      sourceRefs: [{ text: "The delay kept us from leaving early.", occurrence: 1 }],
      useWhenZh: "说明过去没能做某事的原因。",
      reasonZh: "可以替换原因、人物和动作，用于解释阻碍。",
      generatedExample: {
        sourceText: "The storm kept them from going outside.",
        translationZh: "暴风雨让他们无法外出。",
      },
      exampleValues: [
        { name: "cause", text: "The storm" },
        { name: "person", text: "them" },
        { name: "action", text: "going outside" },
      ],
    },
  },
};
