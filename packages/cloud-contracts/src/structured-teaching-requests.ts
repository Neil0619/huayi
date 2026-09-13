import { STRUCTURED_TEACHING_CONTRACT } from "@huayi/learning-domain";
import { z } from "zod/v3";
import { startAnalysisRequestSchema } from "./analysis-contracts.js";
import {
  extensionQueryRequestSchema,
  studyCaptureAnalyzeRequestSchema,
} from "./extension-learning-contracts.js";

const outputContract = z.literal(STRUCTURED_TEACHING_CONTRACT);
const exactSourceText = z.string().min(1).max(2000).regex(/\S/u);
export const startStructuredAnalysisRequestSchema = startAnalysisRequestSchema.extend({
  outputContract,
  sourceText: exactSourceText,
});
export const startAnalysisGenerationRequestSchema = z.union([
  startAnalysisRequestSchema,
  startStructuredAnalysisRequestSchema,
]);
export const structuredCaptureAnalyzeRequestSchema = studyCaptureAnalyzeRequestSchema.extend({
  outputContract,
});
export const captureAnalysisGenerationRequestSchema = z.union([
  studyCaptureAnalyzeRequestSchema,
  structuredCaptureAnalyzeRequestSchema,
]);
export const structuredExtensionQueryRequestSchema = extensionQueryRequestSchema
  .innerType()
  .extend({ outputContract, sourceText: exactSourceText })
  .superRefine((value, context) => {
    const { outputContract, ...request } = value;
    void outputContract;
    const checked = extensionQueryRequestSchema.safeParse(request);
    if (!checked.success) for (const issue of checked.error.issues) context.addIssue(issue);
  })
  .transform((value) =>
    value.action === "explain" &&
    (value.selectionKind === "sentence" || value.selectionKind === "passage")
      ? value
      : { ...value, sourceText: value.sourceText.trim() },
  );
export const extensionQueryGenerationRequestSchema = z.union([
  extensionQueryRequestSchema,
  structuredExtensionQueryRequestSchema,
]);
export type StartAnalysisGenerationRequest = z.infer<typeof startAnalysisGenerationRequestSchema>;
export type CaptureAnalysisGenerationRequest = z.infer<
  typeof captureAnalysisGenerationRequestSchema
>;
export type ExtensionQueryGenerationRequest = z.infer<typeof extensionQueryGenerationRequestSchema>;

export const structuredTeachingAccept = Object.freeze({
  json: 'application/json;profile="seen-said.structured-teaching-v1"',
  eventStream: 'text/event-stream;profile="seen-said.structured-teaching-v1";version=2',
});

function splitOutsideQuotes(text: string, delimiter: string): string[] | undefined {
  const parts: string[] = [];
  let quoted = false,
    escaped = false,
    start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (!quoted && character === delimiter) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || escaped) return undefined;
  parts.push(text.slice(start).trim());
  return parts;
}

/** Read capability only. It must never choose or change the saved generation contract. */
function acceptsRepresentation(
  accept: string | undefined,
  format: "json" | "eventStream",
  structured: boolean,
): boolean {
  if (accept === undefined || accept.length > 4096) return false;
  const expectedMediaType = format === "json" ? "application/json" : "text/event-stream";
  const entries = splitOutsideQuotes(accept, ",");
  let matches = 0;
  let accepted = false;
  for (const entry of entries ?? []) {
    const quality = (() => {
      const parts = splitOutsideQuotes(entry, ";");
      if (parts?.[0]?.toLowerCase() !== expectedMediaType) return undefined;
      const parameters = new Map<string, string>();
      for (const part of parts.slice(1)) {
        const match = /^([a-z][a-z0-9-]*)\s*=\s*(?:"([^"\\]*)"|([^\s";]+))$/iu.exec(part);
        if (!match?.[1]) return undefined;
        const name = match[1].toLowerCase();
        if (parameters.has(name) || !["profile", "version", "q"].includes(name)) return undefined;
        if (name === "q" && match[2] !== undefined) return undefined;
        parameters.set(name, match[2] ?? match[3] ?? "");
      }
      if (
        structured
          ? parameters.get("profile") !== "seen-said.structured-teaching-v1"
          : parameters.has("profile")
      )
        return undefined;
      if (format === "eventStream" ? parameters.get("version") !== "2" : parameters.has("version"))
        return undefined;
      const quality = parameters.get("q") ?? "1";
      return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(quality) ? Number(quality) : undefined;
    })();
    if (quality !== undefined) {
      matches += 1;
      accepted = quality > 0;
    }
  }
  return matches === 1 && accepted;
}

export function acceptsStructuredTeaching(
  accept: string | undefined,
  format: "json" | "eventStream",
): boolean {
  return acceptsRepresentation(accept, format, true);
}

/** Preview v2 also belongs to the structured SSE profile, but never selects generation. */
export function acceptsQueryPreviewV2(accept: string | undefined): boolean {
  return (
    acceptsStructuredTeaching(accept, "eventStream") ||
    acceptsRepresentation(accept, "eventStream", false)
  );
}
