import { z } from "zod/v3";

export interface OutputJsonSchema {
  type: "object" | "array" | "string" | "number" | "integer";
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
  minimum?: number;
  maximum?: number;
}

/** Project only the Zod forms used by compact queries; unsupported forms fail closed.
 * Text-language and cross-field refinements also remain in the prompt and final validator.
 */
export function compactModelJsonSchema(schema: z.ZodType<unknown>): OutputJsonSchema {
  if (schema instanceof z.ZodOptional) return compactModelJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodEffects) return compactModelJsonSchema(schema.innerType());
  if (schema instanceof z.ZodObject) {
    const fields = Object.entries(schema.shape as Readonly<Record<string, z.ZodType<unknown>>>);
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        fields.map(([key, field]) => [key, compactModelJsonSchema(field)]),
      ),
      required: fields.filter(([, field]) => !field.isOptional()).map(([key]) => key),
    };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: compactModelJsonSchema(schema.element),
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
  if (schema instanceof z.ZodNumber)
    return {
      type: schema.isInt ? "integer" : "number",
      ...(schema.minValue === null ? {} : { minimum: schema.minValue }),
      ...(schema.maxValue === null ? {} : { maximum: schema.maxValue }),
    };
  if (schema instanceof z.ZodLiteral && typeof schema.value === "string")
    return { type: "string", const: schema.value };
  throw new Error("Unsupported extension query output schema.");
}
