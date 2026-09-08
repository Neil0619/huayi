import { candidateSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

const publicPatternSchema = candidateSchema.options[1].shape.payload;
export const privatePatternSchema = publicPatternSchema.innerType().extend({
  sourceValues: z
    .array(
      z.strictObject({
        name: publicPatternSchema.innerType().shape.slots.element.shape.name,
        text: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});
type PrivatePattern = z.infer<typeof privatePatternSchema>;

/** Source values are private witnesses, never executable interpolation or public teaching. */
export function sourceBackedPattern(candidate: PrivatePattern, sourceText: string) {
  const { sourceValues, ...payload } = candidate;
  const checked = publicPatternSchema.safeParse(payload);
  if (!checked.success) return { issues: checked.error.issues };
  const values = new Map(sourceValues.map((value) => [value.name, value.text]));
  const names = new Set(payload.slots.map((slot) => slot.name));
  const rendered = payload.template.replace(
    /\{([^{}]+)\}/gu,
    (_, name: string) => values.get(name) ?? "",
  );
  // A practice sentence may add its terminal period to a source headline. Nothing else
  // is normalized: in-text punctuation, case, quotes, numbers and question marks remain exact.
  const matchesSource =
    sourceText.includes(rendered) ||
    (/[\p{L}\p{N}]$/u.test(sourceText) &&
      rendered.endsWith(".") &&
      sourceText.endsWith(rendered.slice(0, -1)));
  if (
    values.size !== sourceValues.length ||
    values.size !== names.size ||
    [...values.keys()].some((name) => !names.has(name)) ||
    !matchesSource
  ) {
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
  return { payload: checked.data };
}
