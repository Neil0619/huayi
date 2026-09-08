import { captureDiagnostic } from "./diagnostic-context.js";
import { safeDiagnosticIssues } from "@huayi/cloud-contracts";
import type { z } from "zod/v3";

export type AnalysisValidationStage = "json" | "output-schema" | "unit-count" | "content-schema";
export type AnalysisValidationAttempt = "first" | "repair";

interface SafeIssue {
  path: string[];
  code: string;
  rule?: string;
}
export interface AnalysisRepairFeedback {
  stage: AnalysisValidationStage;
  issues: SafeIssue[];
  truncated: boolean;
  jsonErrorOffset?: number;
}
interface AnalysisDiagnostic {
  event: "deepseek_analysis_output_invalid";
  stage: AnalysisValidationStage;
  attempt: AnalysisValidationAttempt;
  issues: SafeIssue[];
  truncated: boolean;
}

// Deliberately independent of issue values and dynamic object keys. Extend only for known schema fields.
const KNOWN_FIELDS = new Set([
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
]);
const KNOWN_CODES = new Set([
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
]);
// Only exact source-authored refinement messages can select a fixed label; messages are never emitted.
const CUSTOM_RULES = new Map([
  ["Slot names must be unique.", "slot-names-unique"],
  ["Template placeholders must reference declared slots.", "template-slot-reference"],
  ["Every slot must appear in the template.", "slot-used-in-template"],
  ["Candidate ids must be unique.", "candidate-ids-unique"],
  ["Analysis unit ids and ordinals must be contiguous and ordered.", "analysis-unit-order"],
  ["Analysis result must match its selection kind.", "result-selection-kind"],
  ["Candidate ordinals must be contiguous and ordered.", "candidate-order"],
  ["Every candidate must be referenced once by its analysis unit.", "candidate-unit-reference"],
  ["Phrase candidates are expressions.", "phrase-candidate-type"],
  ["Unknown candidate reference.", "unknown-candidate-reference"],
]);
const MAXIMUM_ISSUES = 16;
const MAXIMUM_VISITED_ISSUES = 64;
const MAXIMUM_UNION_DEPTH = 6;
const MAXIMUM_UNION_BRANCHES = 8;
const MAXIMUM_PATH_SEGMENTS = 8;

/** Best effort only: neither diagnostics construction nor the sink can change validation or billing. */
export function reportDeepSeekAnalysisOutputInvalid(
  stage: AnalysisValidationStage,
  attempt: AnalysisValidationAttempt,
  issues: readonly z.ZodIssue[] = [],
  sink: (diagnostic: AnalysisDiagnostic) => void = (diagnostic) =>
    console.warn(JSON.stringify(diagnostic)),
): AnalysisRepairFeedback {
  let feedback: AnalysisRepairFeedback = { stage, issues: [], truncated: true };
  try {
    const safeIssues: SafeIssue[] = [];
    const seen = new Set<string>();
    let visited = 0;
    let truncated = false;
    function visit(items: readonly z.ZodIssue[], depth: number): void {
      for (const item of items) {
        if (visited >= MAXIMUM_VISITED_ISSUES) {
          truncated = true;
          return;
        }
        visited += 1;
        if (item.path.length > MAXIMUM_PATH_SEGMENTS) truncated = true;
        const safe: SafeIssue = {
          path: item.path
            .slice(0, MAXIMUM_PATH_SEGMENTS)
            .map((part) =>
              typeof part === "number" ? "*" : KNOWN_FIELDS.has(part) ? part : "[redacted]",
            ),
          code: KNOWN_CODES.has(item.code) ? item.code : "unknown",
        };
        const rule = item.code === "custom" ? CUSTOM_RULES.get(item.message) : undefined;
        if (rule !== undefined) safe.rule = rule;
        const key = JSON.stringify(safe);
        if (!seen.has(key)) {
          if (safeIssues.length >= MAXIMUM_ISSUES) {
            truncated = true;
            return;
          }
          safeIssues.push(safe);
          seen.add(key);
        }
        if (item.code !== "invalid_union") continue;
        if (depth >= MAXIMUM_UNION_DEPTH) {
          truncated = true;
          continue;
        }
        if (item.unionErrors.length > MAXIMUM_UNION_BRANCHES) truncated = true;
        for (const branch of item.unionErrors.slice(0, MAXIMUM_UNION_BRANCHES)) {
          visit(branch.issues, depth + 1);
        }
      }
    }
    visit(issues, 0);
    feedback = { stage, issues: safeIssues, truncated };
    captureDiagnostic({
      code: "model_output_invalid",
      stage,
      attempt,
      provider: "deepseek",
      severity: "warn",
      issues: safeDiagnosticIssues(safeIssues),
      issuesTruncated: truncated || safeIssues.length > 8,
    });
    sink({
      event: "deepseek_analysis_output_invalid",
      stage,
      attempt,
      issues: safeIssues,
      truncated,
    });
  } catch {
    // A diagnostic failure must not interrupt the existing repair, error or billing path.
  }
  return feedback;
}

/** Extract only a bounded numeric location; never propagate the engine error message. */
export function analysisJsonErrorOffset(error: unknown, contentLength: number): number | undefined {
  if (!(error instanceof SyntaxError) || !Number.isSafeInteger(contentLength) || contentLength < 0)
    return undefined;
  const match = / at position ([0-9]{1,7})(?: \(line [0-9]+ column [0-9]+\))?$/u.exec(
    error.message,
  );
  if (match === null) return undefined;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= Math.min(contentLength, 1_048_576)
    ? offset
    : undefined;
}
