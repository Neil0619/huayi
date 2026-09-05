import {
  lexicalExplanationResultSchema,
  lexicalTranslationResultSchema,
  passageTranslationResultSchema,
  sentenceExplanationResultSchema,
  storeAnalysisResultSchema,
  wordExplanationResultSchema,
  wordTranslationResultSchema,
  type ExtensionQueryRequest,
  type StoreAnalysisResult,
} from "@huayi/cloud-contracts";
import { z } from "zod/v3";

const privateSchemas = {
  "explain-lexical": lexicalExplanationResultSchema.omit({ requestId: true, sourceText: true }),
  "explain-sentence": sentenceExplanationResultSchema.omit({ requestId: true, sourceText: true }),
  "explain-word": wordExplanationResultSchema.omit({ requestId: true, sourceText: true }),
  "translate-lexical": lexicalTranslationResultSchema.omit({ requestId: true, sourceText: true }),
  "translate-passage": passageTranslationResultSchema.omit({ requestId: true, sourceText: true }),
  "translate-word": wordTranslationResultSchema.omit({ requestId: true, sourceText: true }),
} as const;

interface OutputJsonSchema {
  type: "object" | "array" | "string";
  properties?: Readonly<Record<string, OutputJsonSchema>>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: OutputJsonSchema;
  enum?: readonly string[];
  const?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

/** Project only the Zod forms used by compact queries; unsupported forms fail closed.
 * Text-language and cross-field refinements also remain in the prompt and final validator.
 */
function jsonSchema(schema: z.ZodType<unknown>): OutputJsonSchema {
  if (schema instanceof z.ZodOptional) return jsonSchema(schema.unwrap());
  if (schema instanceof z.ZodEffects) return jsonSchema(schema.innerType());
  if (schema instanceof z.ZodObject) {
    const fields = Object.entries(schema.shape as Readonly<Record<string, z.ZodType<unknown>>>);
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(fields.map(([key, field]) => [key, jsonSchema(field)])),
      required: fields.filter(([, field]) => !field.isOptional()).map(([key]) => key),
    };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: jsonSchema(schema.element),
      ...(schema._def.minLength === null ? {} : { minItems: schema._def.minLength.value }),
      ...(schema._def.maxLength === null ? {} : { maxItems: schema._def.maxLength.value }),
    };
  }
  if (schema instanceof z.ZodString) {
    return {
      type: "string",
      ...(schema.minLength === null ? {} : { minLength: schema.minLength }),
      ...(schema.maxLength === null ? {} : { maxLength: schema.maxLength }),
    };
  }
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodLiteral && typeof schema.value === "string")
    return { type: "string", const: schema.value };
  throw new Error("Unsupported extension query output schema.");
}

function resultType(input: ExtensionQueryRequest): keyof typeof privateSchemas {
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
  readonly resultType: StoreAnalysisResult["type"];
  readonly attempt: "initial" | "repair";
}
type ParsedOutput =
  { success: true; data: StoreAnalysisResult } | { success: false; failure: QueryOutputFailure };

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

export function createQueryOutputContract(input: ExtensionQueryRequest) {
  const type = resultType(input);
  const schema = privateSchemas[type].extend({ selectionKind: z.literal(input.selectionKind) });
  const outputSchema = jsonSchema(schema);
  return {
    type,
    shape: schema.shape as Readonly<Record<string, z.ZodType<unknown>>>,
    instructions: [
      "OUTPUT_JSON_SCHEMA",
      JSON.stringify(outputSchema),
      "END_OUTPUT_JSON_SCHEMA",
      "Follow every required key, nested shape, enum, string limit and array limit in this schema.",
      "Keep required arrays even when empty; only arrays with minItems require entries. Omit unavailable optional fields; never output null or extra keys.",
      "Every field ending in Zh must contain Simplified Chinese. dictionaryForm, baseForm, text and english fields must contain English letters and no Chinese characters.",
      "If pronunciation is present, include at least one non-empty uk or us string; otherwise omit pronunciation.",
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
  resultType: StoreAnalysisResult["type"],
  generationId: string,
  attempt: QueryOutputDiagnostic["attempt"],
  write: (record: QueryOutputDiagnostic) => void = (record) => console.warn(record),
): void {
  try {
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
