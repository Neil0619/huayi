import { captureDiagnostic } from "./diagnostic-context.js";
import {
  safeDiagnosticIssues,
  compactModelJsonSchema,
  type OutputJsonSchema,
  lexicalExplanationResultSchema,
  lexicalTranslationResultSchema,
  passageTranslationResultSchema,
  sentenceExplanationResultSchema,
  storeAnalysisResultSchema,
  wordExplanationResultSchema,
  wordTranslationResultSchema,
  type ExtensionQueryGenerationRequest,
  type StoreAnalysisReadResult,
} from "@huayi/cloud-contracts";
import { z } from "zod/v3";
import {
  assembleStructuredQueryResult,
  privateStructuredQuerySchema,
  structuredQueryInstructions,
} from "./structured-query-output.js";

const privateSchemas = {
  "explain-lexical": lexicalExplanationResultSchema.omit({ requestId: true, sourceText: true }),
  "explain-sentence": sentenceExplanationResultSchema.omit({ requestId: true, sourceText: true }),
  "explain-word": wordExplanationResultSchema.omit({ requestId: true, sourceText: true }),
  "translate-lexical": lexicalTranslationResultSchema.omit({ requestId: true, sourceText: true }),
  "translate-passage": passageTranslationResultSchema.omit({ requestId: true, sourceText: true }),
  "translate-word": wordTranslationResultSchema.omit({ requestId: true, sourceText: true }),
} as const;

function resultType(input: ExtensionQueryGenerationRequest): keyof typeof privateSchemas {
  if (input.selectionKind === "word")
    return input.action === "translate" ? "translate-word" : "explain-word";
  if (input.selectionKind === "phrase")
    return input.action === "translate" ? "translate-lexical" : "explain-lexical";
  return input.action === "translate" ? "translate-passage" : "explain-sentence";
}

const issueCodes = [
  "invalid_type",
  "invalid_literal",
  "invalid_enum_value",
  "unrecognized_keys",
  "too_small",
  "too_big",
  "custom",
] as const;
type OutputIssueCode =
  | (typeof issueCodes)[number]
  | "invalid_json"
  | "invalid_structure"
  | "chinese_text_required"
  | "english_text_required"
  | "pronunciation_required";
interface OutputIssue {
  readonly path: string;
  readonly code: OutputIssueCode;
}
export interface QueryOutputFailure {
  readonly stage: "json" | "schema" | "assembled-result";
  readonly issues: readonly OutputIssue[];
  readonly issuesTruncated: boolean;
}
export interface QueryOutputDiagnostic extends QueryOutputFailure {
  readonly event: "extension-query-output-invalid";
  readonly generationId?: string;
  readonly resultType: StoreAnalysisReadResult["type"];
  readonly attempt: "initial" | "repair";
}
type ParsedOutput =
  | { success: true; data: StoreAnalysisReadResult }
  | { success: false; failure: QueryOutputFailure };

/** Never serialize an issue message, received value, unknown key or model-chosen path. */
function safePath(path: readonly (string | number)[], root: OutputJsonSchema): string {
  let current = root;
  let safe = "";
  for (const part of path.slice(0, 8)) {
    if (typeof part === "number") {
      if (current.type !== "array" || !current.items || !Number.isSafeInteger(part) || part < 0)
        break;
      safe += part < 32 ? `[${part}]` : "[]";
      current = current.items;
    } else {
      const fields = current.properties;
      if (current.type !== "object" || !fields || !Object.hasOwn(fields, part)) break;
      const next = fields[part];
      if (!next) break;
      safe += `${safe === "" ? "" : "."}${part}`;
      current = next;
    }
  }
  return safe || "$";
}

function schemaFailure(
  error: z.ZodError,
  schema: OutputJsonSchema,
  stage: QueryOutputFailure["stage"],
): QueryOutputFailure {
  return {
    stage,
    issues: error.issues.slice(0, 8).map((issue) => {
      const path = safePath(issue.path, schema);
      const code: OutputIssueCode =
        issue.code !== "custom"
          ? (issueCodes.find((code) => code === issue.code) ?? "invalid_structure")
          : issue.message === "Expected Chinese text."
            ? "chinese_text_required"
            : issue.message === "Expected English text."
              ? "english_text_required"
              : path === "pronunciation"
                ? "pronunciation_required"
                : "custom";
      return { path, code };
    }),
    issuesTruncated: error.issues.length > 8,
  };
}

export function createQueryOutputContract(input: ExtensionQueryGenerationRequest) {
  const legacyType = resultType(input);
  const native = "outputContract" in input && legacyType === "explain-sentence";
  const type: StoreAnalysisReadResult["type"] = native ? "explain-sentence-v2" : legacyType;
  const schema = native
    ? privateStructuredQuerySchema
    : privateSchemas[legacyType].extend({ selectionKind: z.literal(input.selectionKind) });
  const outputSchema = compactModelJsonSchema(schema);
  return {
    type,
    native,
    shape: schema.shape as Readonly<Record<string, z.ZodType<unknown>>>,
    instructions: [
      "OUTPUT_JSON_SCHEMA",
      JSON.stringify(outputSchema),
      "END_OUTPUT_JSON_SCHEMA",
      "Follow every required key, nested shape, enum, string limit and array limit in this schema.",
      "Keep required arrays even when empty; only arrays with minItems require entries. Omit unavailable optional fields; never output null or extra keys.",
      "Every field ending in Zh must contain Simplified Chinese. dictionaryForm, baseForm, text and english fields must contain English letters and no Chinese characters.",
      "If pronunciation is present, include at least one non-empty uk or us string; otherwise omit pronunciation.",
      ...(native ? [structuredQueryInstructions] : []),
    ].join("\n"),
    parse(content: string, generationId: string): ParsedOutput {
      let value: unknown;
      try {
        value = JSON.parse(content);
      } catch {
        return {
          success: false,
          failure: {
            stage: "json",
            issues: [{ path: "$", code: "invalid_json" }],
            issuesTruncated: false,
          },
        };
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success)
        return { success: false, failure: schemaFailure(parsed.error, outputSchema, "schema") };
      if (native) {
        try {
          return {
            success: true,
            data: assembleStructuredQueryResult(parsed.data, input, generationId),
          };
        } catch (error) {
          if (!(error instanceof z.ZodError)) throw error;
          return {
            success: false,
            failure: schemaFailure(error, outputSchema, "assembled-result"),
          };
        }
      }
      const result = storeAnalysisResultSchema.safeParse({
        ...parsed.data,
        requestId: generationId,
        sourceText: input.sourceText,
      });
      return result.success
        ? { success: true, data: result.data }
        : {
            success: false,
            failure: schemaFailure(result.error, outputSchema, "assembled-result"),
          };
    },
  };
}

export function reportQueryOutputFailure(
  failure: QueryOutputFailure,
  resultType: StoreAnalysisReadResult["type"],
  generationId: string,
  attempt: QueryOutputDiagnostic["attempt"],
  write: (record: QueryOutputDiagnostic) => void = (record) => console.warn(record),
): void {
  try {
    captureDiagnostic({
      code: "model_output_invalid",
      stage: failure.stage === "assembled-result" ? "output-schema" : failure.stage,
      generationId,
      attempt: attempt === "initial" ? "first" : "repair",
      severity: "warn",
      provider: "deepseek",
      issues: safeDiagnosticIssues(failure.issues),
      issuesTruncated: failure.issuesTruncated || failure.issues.length > 8,
    });
    write({
      event: "extension-query-output-invalid",
      // The live value is a server UUID, never page/model content. Reject unexpected identifiers.
      ...(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(generationId)
        ? { generationId }
        : {}),
      resultType,
      attempt,
      stage: failure.stage,
      issues: failure.issues.map(({ path, code }) => ({ path, code })),
      issuesTruncated: failure.issuesTruncated,
    });
  } catch {
    // An unavailable diagnostic sink must not discard a valid repair or alter known billing.
  }
}
