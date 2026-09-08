import type { StartAnalysisRequest } from "@huayi/cloud-contracts";
import { phraseAnalysisSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";
import { privateAnalysisOutputSchema } from "./deepseek-analysis-private-output.js";

const teachingPointSchema = phraseAnalysisSchema.innerType().shape.usageNotes.element;

interface OutputJsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Readonly<Record<string, OutputJsonSchema>>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: OutputJsonSchema;
  anyOf?: readonly OutputJsonSchema[];
  allOf?: readonly OutputJsonSchema[];
  enum?: readonly string[];
  const?: string | number | boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  $defs?: Readonly<Record<string, OutputJsonSchema>>;
}

function unsupported(): never {
  throw new Error("Unsupported DeepSeek analysis output schema.");
}

function objectSchema(schema: z.ZodObject<z.ZodRawShape>): OutputJsonSchema {
  if (schema._def.unknownKeys !== "strict" || !(schema._def.catchall instanceof z.ZodNever))
    return unsupported();
  const fields = Object.entries(schema.shape as Readonly<Record<string, z.ZodType<unknown>>>);
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(fields.map(([key, field]) => [key, jsonSchema(field)])),
    required: fields.filter(([, field]) => !field.isOptional()).map(([key]) => key),
  };
}

function stringSchema(schema: z.ZodString): OutputJsonSchema {
  const patterns: string[] = [];
  if (schema._def.coerce) return unsupported();
  for (const check of schema._def.checks) {
    if (check.kind === "regex") {
      if (check.regex.flags !== "" && check.regex.flags !== "u") return unsupported();
      patterns.push(check.regex.source);
    } else if (check.kind !== "min" && check.kind !== "max" && check.kind !== "trim") {
      return unsupported();
    }
  }
  return {
    type: "string",
    ...(schema.minLength === null ? {} : { minLength: schema.minLength }),
    ...(schema.maxLength === null ? {} : { maxLength: schema.maxLength }),
    ...(patterns.length === 1 ? { pattern: patterns[0] } : {}),
    ...(patterns.length > 1 ? { allOf: patterns.map((pattern) => ({ pattern })) } : {}),
  };
}

function numberSchema(schema: z.ZodNumber): OutputJsonSchema {
  const projected: OutputJsonSchema = { type: "number" };
  if (schema._def.coerce) return unsupported();
  for (const check of schema._def.checks) {
    if (check.kind === "int") projected.type = "integer";
    else if (check.kind === "min" && check.inclusive)
      projected.minimum = Math.max(projected.minimum ?? -Infinity, check.value);
    else if (check.kind === "max" && check.inclusive)
      projected.maximum = Math.min(projected.maximum ?? Infinity, check.value);
    else return unsupported();
  }
  return projected;
}

/** Only project the domain forms used here. Refinements and trimming remain guidance plus
 * authoritative runtime validation; transforms, coercion and unknown checks fail closed.
 */
function jsonSchema(schema: z.ZodType<unknown>): OutputJsonSchema {
  if (schema === teachingPointSchema) return { $ref: "#/$defs/teachingPoint" };
  if (schema instanceof z.ZodOptional) return jsonSchema(schema.unwrap());
  if (schema instanceof z.ZodEffects) {
    if (schema._def.effect.type !== "refinement") return unsupported();
    return jsonSchema(schema.innerType());
  }
  if (schema instanceof z.ZodObject) return objectSchema(schema);
  if (schema instanceof z.ZodArray) {
    if (schema._def.exactLength !== null) return unsupported();
    return {
      type: "array",
      items: jsonSchema(schema.element),
      ...(schema._def.minLength === null ? {} : { minItems: schema._def.minLength.value }),
      ...(schema._def.maxLength === null ? {} : { maxItems: schema._def.maxLength.value }),
    };
  }
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion)
    return { anyOf: (schema.options as z.ZodType<unknown>[]).map(jsonSchema) };
  if (schema instanceof z.ZodString) return stringSchema(schema);
  if (schema instanceof z.ZodNumber) return numberSchema(schema);
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodLiteral) {
    const value: unknown = schema.value;
    if (typeof value === "string") return { type: "string", const: value };
    if (typeof value === "number" && Number.isFinite(value))
      return { type: "number", const: value };
    if (typeof value === "boolean") return { type: "boolean", const: value };
  }
  return unsupported();
}

export function deepSeekAnalysisOutputContract(
  kind: StartAnalysisRequest["selectionKind"],
): string {
  const schema: OutputJsonSchema = {
    ...jsonSchema(privateAnalysisOutputSchema(kind)),
    $defs: { teachingPoint: objectSchema(teachingPointSchema) },
  };
  return ["OUTPUT_JSON_SCHEMA", JSON.stringify(schema), "END_OUTPUT_JSON_SCHEMA"].join("\n");
}
