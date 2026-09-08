import type { ModelUsage, StartAnalysisRequest } from "@huayi/cloud-contracts";
import type { SegmentedSentence } from "./analysis-ports.js";
import type { AnalysisValidationAttempt } from "./deepseek-analysis-diagnostics.js";
import {
  recoverDeepSeekAnalysisShape,
  trustedDeepSeekAnalysisContent,
} from "./deepseek-analysis-private-output.js";
import { sourceBackedPattern } from "./deepseek-analysis-template-source.js";

/** Optional suggestions may be omitted, never rewritten. The full source, translation,
 * unit count, required shape and public relationships still use the strict validator.
 */
export function readDeepSeekAnalysisContent(
  rawContent: string,
  input: StartAnalysisRequest,
  units: readonly SegmentedSentence[],
  usage: ModelUsage,
  attempt: AnalysisValidationAttempt,
): ReturnType<typeof trustedDeepSeekAnalysisContent> {
  const checked = trustedDeepSeekAnalysisContent(rawContent, input, units, usage, attempt);
  if (checked.feedback?.stage !== "content-schema" && checked.feedback?.stage !== "output-schema")
    return checked;
  const { parsed, omitted } = recoverDeepSeekAnalysisShape(
    JSON.parse(rawContent),
    input.selectionKind,
  );
  if (!parsed.success) return checked;
  const result = parsed.data.result;
  const rows = "sentences" in result ? result.sentences : [result];
  if (rows.length !== units.length) return checked;
  let { teachingPoints, candidates } = omitted;
  for (const [index, row] of rows.entries()) {
    const unit = units[index];
    if (!unit) return checked;
    const keepPoint = (point: { evidenceText?: string | undefined }) => {
      const keep = point.evidenceText === undefined || unit.sourceText.includes(point.evidenceText);
      if (!keep) teachingPoints += 1;
      return keep;
    };
    if ("usageNotes" in row) row.usageNotes = row.usageNotes.filter(keepPoint);
    else {
      row.structure = row.structure.filter(keepPoint);
      row.grammar = row.grammar.filter(keepPoint);
      row.expressions = row.expressions.filter(keepPoint);
      row.languageNotes = row.languageNotes.filter(keepPoint);
    }
    row.candidates = row.candidates.filter((candidate) => {
      const keep =
        candidate.type === "expression"
          ? unit.sourceText.includes(candidate.text)
          : sourceBackedPattern(candidate, unit.sourceText).issues === undefined;
      if (!keep) candidates += 1;
      return keep;
    });
  }
  if (teachingPoints + candidates === 0) return checked;
  const recovered = trustedDeepSeekAnalysisContent(
    JSON.stringify(parsed.data),
    input,
    units,
    usage,
    attempt,
  );
  if (recovered.feedback !== undefined) return checked;
  try {
    console.info(
      JSON.stringify({
        event: "deepseek_analysis_optional_content_omitted",
        attempt,
        teachingPoints,
        candidates,
      }),
    );
  } catch {
    // Diagnostics must not change content, retries or billing.
  }
  return recovered;
}
