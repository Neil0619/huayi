import {
  candidateSchema,
  phraseAnalysisSchema,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";
import type * as contracts from "@huayi/cloud-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";
import { deepSeekAnalysisExample } from "./deepseek-analysis-example.js";
import { deepSeekAnalysisOutputContract } from "./deepseek-analysis-output-contract.js";
import { privateAnalysisOutputSchema } from "./deepseek-analysis-private-output.js";

interface Schema {
  $ref?: string;
  $defs?: Record<string, Schema>;
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  anyOf?: Schema[];
  allOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

function schemaFor(kind: StartAnalysisRequest["selectionKind"]): Schema {
  const match = deepSeekAnalysisOutputContract(kind).match(
    /OUTPUT_JSON_SCHEMA\n(.+)\nEND_OUTPUT_JSON_SCHEMA/u,
  );
  if (!match?.[1]) throw new Error("Missing output JSON schema.");
  return JSON.parse(match[1]) as Schema;
}

function resolve(schema: Schema, root: Schema): Schema {
  if (!schema.$ref) return schema;
  const target = root.$defs?.[schema.$ref.replace("#/$defs/", "")];
  if (!target) throw new Error("Unresolved schema reference.");
  return target;
}

function at(root: Schema, ...path: (string | number)[]): Schema {
  let current = root;
  for (const key of path) {
    current = resolve(current, root);
    const next =
      typeof key === "number"
        ? current.anyOf?.[key]
        : key === "*"
          ? current.items
          : current.properties?.[key];
    if (!next) throw new Error(`Missing schema path: ${path.join(".")}`);
    current = next;
  }
  return resolve(current, root);
}

// Evaluate emitted JSON, independently of Zod, for representative valid and invalid outputs.
function accepts(root: Schema, value: unknown, node: Schema = root): boolean {
  const schema = resolve(node, root);
  if (schema.anyOf) return schema.anyOf.some((branch) => accepts(root, value, branch));
  if (schema.allOf && !schema.allOf.every((branch) => accepts(root, value, branch))) return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
      (schema.required ?? []).every((key) => Object.hasOwn(record, key)) &&
      Object.entries(record).every(([key, item]) => {
        const property = schema.properties?.[key];
        return property ? accepts(root, item, property) : schema.additionalProperties !== false;
      })
    );
  }
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length >= (schema.minItems ?? 0) &&
      value.length <= (schema.maxItems ?? Infinity) &&
      value.every((item) => schema.items && accepts(root, item, schema.items))
    );
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= (schema.maxLength ?? Infinity) &&
      (!schema.pattern || new RegExp(schema.pattern, "u").test(value))
    );
  if (schema.type === "integer" || schema.type === "number")
    return (
      typeof value === "number" &&
      (schema.type !== "integer" || Number.isInteger(value)) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
    );
  if (schema.pattern)
    return typeof value === "string" && new RegExp(schema.pattern, "u").test(value);
  throw new Error("Unsupported test schema.");
}

function checkFields(domain: z.ZodType<unknown>, node: Schema, root: Schema): void {
  const schema = resolve(node, root);
  if (domain instanceof z.ZodOptional) return checkFields(domain.unwrap(), schema, root);
  if (domain instanceof z.ZodEffects) return checkFields(domain.innerType(), schema, root);
  if (domain instanceof z.ZodObject) {
    const fields = Object.entries(domain.shape as Record<string, z.ZodType<unknown>>);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(fields.map(([key]) => key).sort());
    expect([...(schema.required ?? [])].sort()).toEqual(
      fields
        .filter(([, field]) => !field.isOptional())
        .map(([key]) => key)
        .sort(),
    );
    expect(schema.additionalProperties).toBe(false);
    for (const [key, field] of fields) {
      const child = schema.properties?.[key];
      if (!child) throw new Error("Missing domain field.");
      checkFields(field, child, root);
    }
  } else if (domain instanceof z.ZodArray) {
    if (!schema.items) throw new Error("Missing array items.");
    checkFields(domain.element, schema.items, root);
  } else if (domain instanceof z.ZodUnion || domain instanceof z.ZodDiscriminatedUnion) {
    const options = domain.options as z.ZodType<unknown>[];
    expect(schema.anyOf).toHaveLength(options.length);
    options.forEach((option, index) => {
      const branch = schema.anyOf?.[index];
      if (!branch) throw new Error("Missing union variant.");
      checkFields(option, branch, root);
    });
  }
}

function example(kind: StartAnalysisRequest["selectionKind"]) {
  const json = deepSeekAnalysisExample(kind).split("\n")[1];
  return privateAnalysisOutputSchema(kind).parse(JSON.parse(json ?? "null"));
}

afterEach(() => {
  vi.doUnmock("@huayi/cloud-contracts");
  vi.resetModules();
});

describe("compact analysis output contract", () => {
  it.each(["phrase", "sentence", "passage"] as const)(
    "preserves all private %s fields and independent emitted JSON constraints",
    (kind) => {
      const schema = schemaFor(kind),
        output = example(kind);
      expect(Object.keys(schema.properties ?? {})).toEqual(["previewZh", "result"]);
      expect(schema.required).toEqual(["previewZh", "result"]);
      checkFields(privateAnalysisOutputSchema(kind), schema, schema);
      expect(accepts(schema, output)).toBe(true);
      for (const previewZh of [undefined, "", "字".repeat(1001)])
        expect(accepts(schema, { ...output, previewZh })).toBe(false);
      for (const key of ["candidates", "metadata", "source", "type", "ordinal"])
        expect(accepts(schema, { ...output, [key]: [] })).toBe(false);
    },
  );

  it("preserves overall and teaching fields without provider identity, ordinals or global references", () => {
    const schema = schemaFor("sentence"),
      output = example("sentence");
    if (!("sentences" in output.result)) throw new Error("Wrong example.");
    expect(at(schema, "result", "overall").required).toEqual(["translationZh", "understandingZh"]);
    expect(at(schema, "result", "sentences")).toMatchObject({ minItems: 1, maxItems: 40 });
    const unit = at(schema, "result", "sentences", "*");
    for (const key of ["analysisUnitId", "candidateIds", "ordinal", "sourceText"])
      expect(unit.properties).not.toHaveProperty(key);
    for (const group of ["structure", "grammar", "expressions", "languageNotes"]) {
      expect(unit.required).toContain(group);
      expect(at(schema, "result", "sentences", "*", group).maxItems).toBe(20);
    }
    expect(
      accepts(schema, {
        ...output,
        result: { ...output.result, overall: { understandingZh: "理解" } },
      }),
    ).toBe(false);
    expect(
      accepts(schema, {
        ...output,
        result: {
          ...output.result,
          sentences: output.result.sentences.map((s) => ({ ...s, candidates: [] })),
        },
      }),
    ).toBe(true);
    expect(accepts(schema, { ...output, result: { ...output.result, sentences: [] } })).toBe(false);
  });

  it("keeps optional examples on teaching points and distinct phrase/candidate register contracts", () => {
    const schema = schemaFor("phrase"),
      output = example("phrase");
    if (!("usageNotes" in output.result)) throw new Error("Wrong example.");
    const teaching = at(schema, "result", "usageNotes", "*");
    checkFields(phraseAnalysisSchema.innerType().shape.usageNotes.element, teaching, schema);
    expect(teaching.required).toEqual(["explanationZh", "label"]);
    expect(at(schema, "result", "usageNotes", "*", "generatedExample").required).toEqual([
      "sourceText",
      "translationZh",
    ]);
    expect(at(schema, "result", "register")).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 200,
    });
    expect(at(schema, "result", "candidates", "*", "register").enum).toEqual([
      "neutral",
      "formal",
      "informal",
      "literary",
      "spoken",
    ]);
    for (const extra of [
      { generatedExample: { sourceText: "Works.", translationZh: "有效。" } },
      { commonMistakeZh: "误区" },
    ]) {
      expect(accepts(schema, { ...output, result: { ...output.result, ...extra } })).toBe(false);
      expect(
        accepts(schema, {
          ...output,
          result: {
            ...output.result,
            candidates: output.result.candidates.map((c) => ({ ...c, ...extra })),
          },
        }),
      ).toBe(false);
    }
    expect(accepts(schema, { ...output, result: { ...output.result, register: null } })).toBe(
      false,
    );
    expect(
      accepts(schema, {
        ...output,
        result: { ...output.result, candidates: [{ type: "sentence_pattern" }] },
      }),
    ).toBe(false);
  });

  it("projects candidate bounds and actual payload shapes without global bookkeeping", () => {
    const schema = schemaFor("sentence"),
      base = ["result", "sentences", "*", "candidates"];
    expect(at(schema, ...base).maxItems).toBe(20);
    checkFields(candidateSchema.options[0].shape.payload, at(schema, ...base, "*", 0), schema);
    const patternSchema = at(schema, ...base, "*", 1);
    const { sourceValues, ...publicProperties } = patternSchema.properties ?? {};
    expect(sourceValues).toMatchObject({ type: "array", minItems: 1 });
    checkFields(
      candidateSchema.options[1].shape.payload,
      {
        ...patternSchema,
        properties: publicProperties,
        required: patternSchema.required?.filter((name) => name !== "sourceValues") ?? [],
      },
      schema,
    );
    expect(at(schema, ...base, "*", 0, "text").maxLength).toBe(500);
    expect(at(schema, ...base, "*", 1, "slots")).toMatchObject({ minItems: 1, maxItems: 12 });
    expect(at(schema, ...base, "*", 1, "slots", "*", "name").pattern).toBe(
      "^[A-Za-z][A-Za-z0-9_-]{0,39}$",
    );
    const pattern = {
      type: "sentence_pattern",
      template: "{subject} acts.",
      sourceValues: [{ name: "subject", text: "She" }],
      slots: [{ name: "subject", descriptionZh: "主语" }],
      functionZh: "描述动作",
      usageZh: "陈述事实。",
    };
    expect(accepts(schema, pattern, at(schema, ...base, "*"))).toBe(true);
    for (const names of [
      [],
      ["主语"],
      ["two words"],
      ["1value"],
      Array.from({ length: 13 }, (_, i) => `slot${i}`),
    ]) {
      const invalid = {
        ...pattern,
        slots: names.map((name) => ({ name, descriptionZh: "内容" })),
        template: names.map((n) => `{${n}}`).join(" ") || "No slots.",
      };
      expect(accepts(schema, invalid, at(schema, ...base, "*"))).toBe(false);
      expect(candidateSchema.options[1].shape.payload.safeParse(invalid).success).toBe(false);
    }
  });

  it.each([
    z.boolean(),
    z.string().email(),
    z.number().multipleOf(2),
    z.object({ value: z.string() }),
    z.string().transform((v) => v.length),
  ])("fails closed for unsupported private domain change %#", async (unsupported) => {
    vi.doMock("@huayi/cloud-contracts", async (importOriginal) => {
      const original = await importOriginal<typeof contracts>();
      return {
        ...original,
        phraseAnalysisSchema: original.phraseAnalysisSchema
          .innerType()
          .extend({ unsupported })
          .superRefine(() => undefined),
      };
    });
    const { deepSeekAnalysisOutputContract: project } =
      await import("./deepseek-analysis-output-contract.js");
    expect(() => project("phrase")).toThrow("Unsupported DeepSeek analysis output schema");
  });
});
