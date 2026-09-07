import { z } from "zod/v3";

const field = z.enum([
  "*",
  "[redacted]",
  "previewZh",
  "candidates",
  "result",
  "analysisUnitId",
  "id",
  "ordinal",
  "payload",
  "type",
  "meaningZh",
  "register",
  "text",
  "usageZh",
  "functionZh",
  "slots",
  "descriptionZh",
  "name",
  "template",
  "candidateIds",
  "contextualMeaningZh",
  "structureAndCollocationZh",
  "translationZh",
  "usageNotes",
  "commonMistakeZh",
  "evidenceText",
  "explanationZh",
  "generatedExample",
  "label",
  "sourceText",
  "overall",
  "contextAndToneZh",
  "understandingZh",
  "sentences",
  "expressions",
  "grammar",
  "languageNotes",
  "structure",
  "modelMetadata",
  "inputTokens",
  "model",
  "outputTokens",
  "promptVersion",
  "provider",
  "schemaVersion",
  "selectionKind",
  "source",
  "title",
  "userContext",
  "sourceNormalizedHash",
  "studyCaptureId",
  "headword",
  "pronunciation",
  "phonetics",
  "senses",
  "partOfSpeech",
  "definitionZh",
  "examples",
  "translation",
  "collocations",
  "usage",
  "word",
  "meaning",
  "explanation",
  "summary",
  "chunks",
  "notes",
  "forms",
  "contextRole",
  "keyExpressions",
  "mainStructure",
  "lemma",
  "pronunciationIpa",
]);
const code = z.enum([
  "unknown",
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite",
  "invalid_json",
  "invalid_structure",
  "chinese_text_required",
  "english_text_required",
  "pronunciation_required",
]);
const rule = z.enum([
  "slot-names-unique",
  "template-slot-reference",
  "slot-used-in-template",
  "candidate-ids-unique",
  "analysis-unit-order",
  "result-selection-kind",
  "candidate-order",
  "candidate-unit-reference",
  "phrase-candidate-type",
  "unknown-candidate-reference",
]);
export const diagnosticIssueSchema = z.strictObject({
  path: z.array(field).max(6),
  code,
  rule: rule.optional(),
});

/** Accept paths from existing sanitizers, then enforce a second finite vocabulary for storage/upload. */
export function safeDiagnosticIssues(
  issues: readonly { path: string | readonly (string | number)[]; code: string; rule?: string }[],
) {
  return issues.slice(0, 8).map((issue) => {
    const parts =
      typeof issue.path === "string"
        ? issue.path
            .replace(/\[\d*\]/gu, ".*")
            .split(".")
            .filter(Boolean)
        : issue.path;
    const parsedCode = code.safeParse(issue.code);
    const parsedRule = rule.safeParse(issue.rule);
    return {
      path: parts.slice(0, 6).map((part) => {
        const parsed = field.safeParse(typeof part === "number" ? "*" : part);
        return parsed.success ? parsed.data : ("[redacted]" as const);
      }),
      code: parsedCode.success ? parsedCode.data : ("unknown" as const),
      ...(parsedRule.success ? { rule: parsedRule.data } : {}),
    };
  });
}
