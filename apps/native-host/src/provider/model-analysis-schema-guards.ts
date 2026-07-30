import { z } from "zod";

export type RawOwnKeyShape =
  | { item: RawOwnKeyShape; kind: "array" }
  | { kind: "leaf" }
  | { kind: "nullable"; value: RawOwnKeyShape }
  | RawOwnKeyObjectShape;

export interface RawOwnKeyObjectShape {
  fields: ReadonlyMap<string, RawOwnKeyShape>;
  kind: "object";
}

export const RAW_OWN_KEY_LEAF = { kind: "leaf" } as const satisfies RawOwnKeyShape;

export function rawOwnKeyArray(item: RawOwnKeyShape): RawOwnKeyShape {
  return { item, kind: "array" };
}

export function rawOwnKeyNullable(value: RawOwnKeyShape): RawOwnKeyShape {
  return { kind: "nullable", value };
}

export function rawOwnKeyObjectFor(
  schema: { readonly shape: object },
  nestedFields: ReadonlyMap<string, RawOwnKeyShape> = new Map(),
): RawOwnKeyObjectShape {
  return {
    fields: new Map(
      Object.keys(schema.shape).map((field) => [
        field,
        nestedFields.get(field) ?? RAW_OWN_KEY_LEAF,
      ]),
    ),
    kind: "object",
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRawOwnKeys(
  value: unknown,
  shape: RawOwnKeyShape,
  context: z.RefinementCtx,
  path: (number | string)[] = [],
): void {
  if (shape.kind === "leaf") return;
  if (shape.kind === "nullable") {
    if (value !== null) validateRawOwnKeys(value, shape.value, context, path);
    return;
  }
  if (shape.kind === "array") {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        validateRawOwnKeys(item, shape.item, context, [...path, index]),
      );
    }
    return;
  }
  if (!isObjectRecord(value)) return;

  for (const field of Object.keys(value)) {
    const fieldShape = shape.fields.get(field);
    if (fieldShape === undefined) {
      context.addIssue({
        code: "custom",
        message: "Unrecognized model field.",
        path: [...path, field],
      });
      continue;
    }
    validateRawOwnKeys(value[field], fieldShape, context, [...path, field]);
  }
}

export function withRawOwnKeyValidation<Output>(
  schema: z.ZodType<Output>,
  shape: RawOwnKeyShape,
): z.ZodType<Output> {
  return z.preprocess((value, context) => {
    validateRawOwnKeys(value, shape, context);
    return value;
  }, schema);
}

export function guardedFieldSchemasFor(
  schema: { readonly shape: Readonly<Record<string, z.ZodType>> },
  shape: RawOwnKeyObjectShape,
): ReadonlyMap<string, z.ZodType> {
  const fields = new Map<string, z.ZodType>();
  for (const [field, fieldSchema] of Object.entries(schema.shape)) {
    fields.set(
      field,
      withRawOwnKeyValidation(fieldSchema, shape.fields.get(field) ?? RAW_OWN_KEY_LEAF),
    );
  }
  return fields;
}
