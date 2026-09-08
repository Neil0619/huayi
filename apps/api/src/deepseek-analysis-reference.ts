// Reviewed paraphrases; provenance and the limited validation status are documented in
// docs/cloud-v1/deep-analysis-generation.md. No live lookup or learner text enters these notes.
const grammarNotes = [
  {
    id: "only-if-necessary",
    pattern: /\bonly\s+if\b/iu,
    note: "一般的要求、许可、操作条件中，X only if Y 给出 X 所需的条件 Y；没有 Y 就不能有 X。仅凭这个表达，不能断言 Y 是唯一条件、唯一必要条件，也不能保证只要 Y 就一定 X。还可能有其他条件。按具体语境说明依赖和时间，不把所有英语 if 句机械视作形式逻辑等价式。",
  },
  {
    id: "quantity-and-object",
    pattern: /\b(?:less|fewer)\b/iu,
    note: "less/fewer 后有名词时通常限定数量，less 常与不可数名词、fewer 常与复数可数名词连用。数量词描述多少，副词还可描述程度或动作方式。名词短语的句法角色要按本句结构判断；承受动作的人或物也可能是被动句主语，不能仅凭语义认定宾语。即使宾语在比较结构中前置，也不能把整个名词短语称为修饰动作的副词。不一概把所有名词短语叫作宾语。",
  },
] as const;

export function reviewedAnalysisGrammarNotes(sourceText: string): string {
  const notes = grammarNotes
    .filter(({ pattern }) => pattern.test(sourceText))
    .map(({ id, note }) => ({ id, note }));
  return notes.length === 0
    ? ""
    : [
        "REVIEWED_GRAMMAR_NOTES",
        "经核对的相关语法提示：只在本材料适用时使用，不能添加原文事实。",
        JSON.stringify(notes),
        "END_REVIEWED_GRAMMAR_NOTES",
      ].join("\n");
}
