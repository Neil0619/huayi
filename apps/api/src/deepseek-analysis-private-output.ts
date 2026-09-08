import { createHash } from "node:crypto";
import { z } from "zod/v3";
import {
  analysisContentSchema,
  normalizeWhitespaceAndQuotes,
  candidateSchema,
  phraseAnalysisSchema,
  sentencePassageAnalysisSchema,
  type AnalysisContent,
  type ModelUsage,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";
import { privatePatternSchema, sourceBackedPattern } from "./deepseek-analysis-template-source.js";
type Candidate = AnalysisContent["candidates"][number];
const expressionSchema = candidateSchema.options[0].shape.payload;
const learningItemContentSchema = z.union([expressionSchema, privatePatternSchema]);
import type { SegmentedSentence } from "./analysis-ports.js";
import {
  analysisJsonErrorOffset,
  reportDeepSeekAnalysisOutputInvalid,
  type AnalysisRepairFeedback,
  type AnalysisValidationAttempt,
} from "./deepseek-analysis-diagnostics.js";

const sentencePublic = sentencePassageAnalysisSchema.innerType();
const sentence = sentencePublic.shape.sentences.element
  .omit({ analysisUnitId: true, candidateIds: true, ordinal: true, sourceText: true })
  .extend({ candidates: z.array(learningItemContentSchema).max(20) });
const passage = z.strictObject({
  overall: sentencePublic.shape.overall,
  sentences: z.array(sentence).min(1).max(40),
});
const phrase = phraseAnalysisSchema
  .innerType()
  .omit({ analysisUnitId: true, candidateIds: true, type: true })
  .extend({ candidates: z.array(expressionSchema).max(20) });

export function privateAnalysisOutputSchema(kind: StartAnalysisRequest["selectionKind"]) {
  return z.strictObject({
    previewZh: z.string().trim().min(1).max(1000),
    result: kind === "phrase" ? phrase : passage,
  });
}

/** Only items inside optional teaching/suggestion arrays may be omitted. Required fields,
 * unknown outer keys and original array bounds remain subject to the same strict schema.
 */
export function recoverDeepSeekAnalysisShape(
  json: unknown,
  kind: StartAnalysisRequest["selectionKind"],
) {
  const omitted = { teachingPoints: 0, candidates: 0 };
  const recoverArray = (schema: z.ZodArray<z.ZodType<unknown>>, group: keyof typeof omitted) => {
    let array = z.array(z.unknown());
    if (schema._def.minLength !== null) array = array.min(schema._def.minLength.value);
    if (schema._def.maxLength !== null) array = array.max(schema._def.maxLength.value);
    if (schema._def.exactLength !== null) array = array.length(schema._def.exactLength.value);
    return array.transform((values) =>
      values.flatMap((value) => {
        const checked = schema.element.safeParse(value);
        if (checked.success) return [checked.data];
        omitted[group] += 1;
        return [];
      }),
    );
  };
  const result =
    kind === "phrase"
      ? phrase.extend({
          usageNotes: recoverArray(phrase.shape.usageNotes, "teachingPoints"),
          candidates: recoverArray(phrase.shape.candidates, "candidates"),
        })
      : passage.extend({
          sentences: z
            .array(
              sentence.extend({
                structure: recoverArray(sentence.shape.structure, "teachingPoints"),
                grammar: recoverArray(sentence.shape.grammar, "teachingPoints"),
                expressions: recoverArray(sentence.shape.expressions, "teachingPoints"),
                languageNotes: recoverArray(sentence.shape.languageNotes, "teachingPoints"),
                candidates: recoverArray(sentence.shape.candidates, "candidates"),
              }),
            )
            .min(1)
            .max(40),
        });
  const parsed = privateAnalysisOutputSchema(kind)
    .extend({ result })
    .pipe(privateAnalysisOutputSchema(kind))
    .safeParse(json);
  return { parsed, omitted };
}

export function trustedDeepSeekAnalysisContent(
  rawContent: string,
  input: StartAnalysisRequest,
  units: readonly SegmentedSentence[],
  usage: ModelUsage,
  attempt: AnalysisValidationAttempt,
): { content: unknown; feedback?: never } | { content?: never; feedback: AnalysisRepairFeedback } {
  const feedback = (
    stage: Parameters<typeof reportDeepSeekAnalysisOutputInvalid>[0],
    issues: readonly z.ZodIssue[] = [],
  ) => reportDeepSeekAnalysisOutputInvalid(stage, attempt, issues);
  let json: unknown;
  try {
    json = JSON.parse(rawContent);
  } catch (error) {
    const detail = feedback("json");
    const offset = analysisJsonErrorOffset(error, rawContent.length);
    if (offset !== undefined) detail.jsonErrorOffset = offset;
    return { feedback: detail };
  }
  const checked = privateAnalysisOutputSchema(input.selectionKind).safeParse(json);
  if (!checked.success) return { feedback: feedback("output-schema", checked.error.issues) };
  const result = checked.data.result;
  const rows = "sentences" in result ? result.sentences : [result];
  if (rows.length !== units.length) return { feedback: feedback("unit-count") };
  const candidates: Candidate[] = [];
  const issues: z.ZodIssue[] = [];
  const mapped = rows.map((row, index) => {
    const unit = units[index];
    if (!unit) throw new Error("Missing trusted analysis unit.");
    const base = "usageNotes" in row ? ["result"] : ["result", "sentences", index];
    const exact = (text: string, path: (string | number)[]) => {
      if (!unit.sourceText.includes(text))
        issues.push({ code: "custom", path, message: "Exact source fragment required." });
    };
    const groups =
      "usageNotes" in row
        ? { usageNotes: row.usageNotes }
        : {
            structure: row.structure,
            grammar: row.grammar,
            expressions: row.expressions,
            languageNotes: row.languageNotes,
          };
    for (const [group, points] of Object.entries(groups)) {
      points?.forEach((point, i) => {
        if (point.evidenceText !== undefined)
          exact(point.evidenceText, [...base, group, i, "evidenceText"]);
      });
    }
    const candidateIds = row.candidates.flatMap((candidate, i) => {
      let payload: Candidate["payload"];
      if (candidate.type === "expression") {
        exact(candidate.text, [...base, "candidates", i, "text"]);
        payload = candidate;
      } else {
        const checkedPattern = sourceBackedPattern(candidate, unit.sourceText);
        if (checkedPattern.issues) {
          issues.push(
            ...checkedPattern.issues.map((issue) => ({
              ...issue,
              path: [...base, "candidates", i, ...issue.path],
            })),
          );
          return [];
        }
        payload = checkedPattern.payload;
      }
      const ordinal = candidates.length,
        id = `c${ordinal + 1}`;
      candidates.push(
        payload.type === "expression"
          ? { analysisUnitId: unit.analysisUnitId, id, ordinal, payload, type: "expression" }
          : { analysisUnitId: unit.analysisUnitId, id, ordinal, payload, type: "sentence-pattern" },
      );
      return [id];
    });
    const { candidates: privateCandidates, ...teaching } = row;
    void privateCandidates;
    return "usageNotes" in row
      ? { ...teaching, analysisUnitId: "u1", candidateIds, type: "phrase-analysis-v2" }
      : { ...teaching, ...unit, candidateIds };
  });
  if (issues.length > 0) return { feedback: feedback("content-schema", issues) };
  const content = analysisContentSchema.safeParse({
    ...input,
    candidates,
    result:
      "sentences" in result
        ? { type: "sentence-passage-analysis-v2", overall: result.overall, sentences: mapped }
        : mapped[0],
    sourceNormalizedHash: createHash("sha256")
      .update(normalizeWhitespaceAndQuotes(input.sourceText))
      .digest("hex"),
    modelMetadata: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: "web-deep-analysis-v2.11-balanced",
      schemaVersion: 2,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  });
  return content.success
    ? { content: content.data }
    : { feedback: feedback("content-schema", content.error.issues) };
}
