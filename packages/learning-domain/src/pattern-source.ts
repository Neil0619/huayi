import { z } from "zod/v3";
import { sentencePatternSchema } from "./domain-schemas.js";

export const patternSourceValuesSchema = z
  .array(
    z.strictObject({
      name: sentencePatternSchema.innerType().shape.slots.element.shape.name,
      text: z.string().min(1).max(2000),
    }),
  )
  .min(1)
  .max(20);
export const sourceBackedPatternSchema = sentencePatternSchema.innerType().extend({
  sourceValues: patternSourceValuesSchema,
});
type SourceBackedPattern = z.infer<typeof sourceBackedPatternSchema>;

/** Substitute literal values only; never evaluate templates or normalize source witnesses. */
export function renderPatternWithValues(pattern: unknown, sourceValues: unknown): string {
  const payload = sentencePatternSchema.parse(pattern);
  const parsed = patternSourceValuesSchema.parse(sourceValues);
  const values = new Map(parsed.map((value) => [value.name, value.text]));
  const names = new Set(payload.slots.map((slot) => slot.name));
  if (
    values.size !== parsed.length ||
    values.size !== names.size ||
    [...values.keys()].some((name) => !names.has(name))
  )
    throw new z.ZodError([
      {
        code: "custom",
        path: ["sourceValues"],
        message: "Every declared slot must have exactly one literal value.",
      },
    ]);
  return payload.template.replace(/\{([^{}]+)\}/gu, (_, name: string) => values.get(name) ?? "");
}

/** Retains the existing headline terminal-period exception; the returned fragment stays exact. */
export function sourcePatternFragment(rendered: string, sourceText: string): string | undefined {
  if (sourceText.includes(rendered)) return rendered;
  if (
    /[\p{L}\p{N}]$/u.test(sourceText) &&
    rendered.endsWith(".") &&
    sourceText.endsWith(rendered.slice(0, -1))
  )
    return rendered.slice(0, -1);
  return undefined;
}

/** Private source witnesses are discarded before a candidate becomes public teaching. */
export function sourceBackedPattern(candidate: SourceBackedPattern, sourceText: string) {
  const { sourceValues, ...payload } = candidate;
  const checked = sentencePatternSchema.safeParse(payload);
  if (!checked.success) return { issues: checked.error.issues };
  try {
    const rendered = renderPatternWithValues(checked.data, sourceValues);
    if (sourcePatternFragment(rendered, sourceText) !== undefined) return { payload: checked.data };
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
  }
  return {
    issues: [
      {
        code: "custom" as const,
        path: ["template"],
        message: "Template must reconstruct an exact source fragment.",
      },
    ],
  };
}
