import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  modelAnalysisResultSchemaFor,
  modelLexicalExplanationSchema,
  modelLexicalTranslationSchema,
  modelPassageTranslationSchema,
  modelSentenceExplanationSchema,
} from "./model-analysis-schemas.js";

type JsonObject = Record<string, unknown>;

const outputSchemaNames = [
  "translate-lexical",
  "translate-passage",
  "explain-lexical",
  "explain-sentence",
] as const;
type OutputSchemaName = (typeof outputSchemaNames)[number];

const expectedPropertyOrder = {
  "explain-lexical": [
    "contextualMeaningZh",
    "baseForm",
    "wordFormation",
    "coreMeanings",
    "collocations",
    "synonyms",
  ],
  "explain-sentence": ["mainStructure", "keyExpressions", "translationZh", "contextRole"],
  "translate-lexical": [
    "contextualMeaningZh",
    "partOfSpeech",
    "pronunciation",
    "collocations",
    "contextExampleTranslationZh",
    "similarTerms",
  ],
  "translate-passage": ["translationZh"],
} as const;

const partOfSpeechValues = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "determiner",
  "modal",
  "number",
  "particle",
  "phrase",
  "other",
];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOutputSchemaSource(name: OutputSchemaName): string {
  const path = fileURLToPath(new URL(`./schemas/${name}.json`, import.meta.url));
  return readFileSync(path, "utf8");
}

function readOutputSchema(name: OutputSchemaName): JsonObject {
  const parsed: unknown = JSON.parse(readOutputSchemaSource(name));
  if (!isJsonObject(parsed)) throw new Error(`${name}.json must contain a JSON object.`);
  return parsed;
}

function objectProperty(schema: JsonObject, name: string): JsonObject {
  const properties = schema.properties;
  if (!isJsonObject(properties) || !isJsonObject(properties[name])) {
    throw new Error(`Expected object property schema: ${name}.`);
  }
  return properties[name];
}

function collectObjectSchemas(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectObjectSchemas(item));
  if (!isJsonObject(value)) return [];
  const nested = Object.values(value).flatMap((item) => collectObjectSchemas(item));
  return value.type === "object" ? [value, ...nested] : nested;
}

function collectPatterns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectPatterns(item));
  if (!isJsonObject(value)) return [];
  const current = typeof value.pattern === "string" ? [value.pattern] : [];
  return [...current, ...Object.values(value).flatMap((item) => collectPatterns(item))];
}

function validateSubset(schemaValue: unknown, value: unknown, path = "$"): string[] {
  if (!isJsonObject(schemaValue)) return [`${path}: schema is not an object`];

  const errors: string[] = [];
  if (schemaValue.const !== undefined && value !== schemaValue.const) {
    errors.push(`${path}: value does not equal const`);
  }
  if (Array.isArray(schemaValue.enum) && !schemaValue.enum.includes(value)) {
    errors.push(`${path}: value is not in enum`);
  }
  if (Array.isArray(schemaValue.anyOf)) {
    const matches = schemaValue.anyOf.some(
      (candidate) => validateSubset(candidate, value, path).length === 0,
    );
    return matches ? errors : [...errors, `${path}: value does not match anyOf`];
  }
  if (schemaValue.type === "null") {
    return value === null ? errors : [...errors, `${path}: expected null`];
  }
  if (Array.isArray(schemaValue.required) && isJsonObject(value)) {
    for (const requiredName of schemaValue.required) {
      if (typeof requiredName === "string" && !(requiredName in value)) {
        errors.push(`${path}: missing ${requiredName}`);
      }
    }
  }

  if (schemaValue.type === "string") {
    if (typeof value !== "string") return [...errors, `${path}: expected string`];
    if (typeof schemaValue.minLength === "number" && value.length < schemaValue.minLength) {
      errors.push(`${path}: string is shorter than minLength`);
    }
    if (typeof schemaValue.maxLength === "number" && value.length > schemaValue.maxLength) {
      errors.push(`${path}: string is longer than maxLength`);
    }
    if (
      typeof schemaValue.pattern === "string" &&
      !new RegExp(schemaValue.pattern, "u").test(value)
    ) {
      errors.push(`${path}: string does not match pattern`);
    }
  }

  if (schemaValue.type === "array") {
    if (!Array.isArray(value)) return [...errors, `${path}: expected array`];
    if (typeof schemaValue.minItems === "number" && value.length < schemaValue.minItems) {
      errors.push(`${path}: array is shorter than minItems`);
    }
    if (typeof schemaValue.maxItems === "number" && value.length > schemaValue.maxItems) {
      errors.push(`${path}: array is longer than maxItems`);
    }
    value.forEach((item, index) => {
      errors.push(...validateSubset(schemaValue.items, item, `${path}[${index}]`));
    });
  }

  if (schemaValue.type === "object") {
    if (!isJsonObject(value)) return [...errors, `${path}: expected object`];
    const properties = isJsonObject(schemaValue.properties) ? schemaValue.properties : {};
    if (schemaValue.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!(name in properties)) errors.push(`${path}: unknown property ${name}`);
      }
    }
    for (const [name, propertyValue] of Object.entries(value)) {
      if (name in properties) {
        errors.push(...validateSubset(properties[name], propertyValue, `${path}.${name}`));
      }
    }
  }

  return errors;
}

const terms = [
  { meaningZh: "调查", partOfSpeech: "noun", text: "inquiry" },
  { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
  { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
];

const collocations = [
  { meaningZh: "刑事调查", text: "criminal investigation" },
  { meaningZh: "展开调查", text: "launch an investigation" },
];

const contractCases = [
  {
    name: "translate-lexical",
    resultSchema: modelLexicalTranslationSchema,
    value: {
      collocations: [],
      contextExampleTranslationZh: null,
      contextualMeaningZh: "在这里表示数字四。",
      partOfSpeech: "number",
      pronunciation: { uk: null, us: null },
      similarTerms: [],
    },
  },
  {
    name: "translate-passage",
    resultSchema: modelPassageTranslationSchema,
    value: { translationZh: "第一句。\n第二句。" },
  },
  {
    name: "explain-lexical",
    resultSchema: modelLexicalExplanationSchema,
    value: {
      baseForm: null,
      collocations: [],
      contextualMeaningZh: "在这里表示数字四。",
      coreMeanings: [{ meaningZh: "数字四", partOfSpeech: "number" }],
      synonyms: [],
      wordFormation: null,
    },
  },
  {
    name: "explain-sentence",
    resultSchema: modelSentenceExplanationSchema,
    value: {
      contextRole: "说明调查阶段。",
      keyExpressions: [{ meaningZh: "处于早期阶段", text: "in its early stages" }],
      mainStructure: "He said ...",
      translationZh: "他说调查仍处于早期阶段。",
    },
  },
] as const;

function expectSchemaAgreement(name: OutputSchemaName, value: unknown, expected: boolean): void {
  expect(modelAnalysisResultSchemaFor(name).safeParse(value).success).toBe(expected);
  expect(validateSubset(readOutputSchema(name), value).length === 0).toBe(expected);
}

describe("Codex output schemas", () => {
  it("orders model-only content by visual priority with the streamable core string first", () => {
    for (const name of outputSchemaNames) {
      const schema = readOutputSchema(name);
      if (!isJsonObject(schema.properties)) throw new Error(`${name}.json must define properties.`);
      expect(Object.keys(schema.properties)).toEqual(expectedPropertyOrder[name]);
      expect(schema.required).toEqual(expectedPropertyOrder[name]);
    }
  });

  it("defines only strict required model content and omits all public metadata", () => {
    for (const name of outputSchemaNames) {
      const schema = readOutputSchema(name);
      expect(schema).toMatchObject({ additionalProperties: false, type: "object" });
      if (!isJsonObject(schema.properties)) throw new Error(`${name}.json must define properties.`);
      for (const metadataField of ["sourceText", "selectionKind", "type"]) {
        expect(Object.keys(schema.properties)).not.toContain(metadataField);
      }
      expect(readOutputSchemaSource(name)).not.toMatch(/"(?:sourceText|selectionKind)"\s*:/u);
      for (const objectSchema of collectObjectSchemas(schema)) {
        expect(objectSchema.additionalProperties).toBe(false);
      }
    }
  });

  it("avoids regex lookaround unsupported by Codex Structured Outputs", () => {
    for (const name of outputSchemaNames) {
      for (const pattern of collectPatterns(readOutputSchema(name))) {
        expect(pattern).not.toMatch(/\(\?[=!<]/u);
      }
    }
  });

  it("uses public child contracts and the exact lexical collection limits", () => {
    for (const name of ["translate-lexical", "explain-lexical"] as const) {
      const schema = readOutputSchema(name);
      const relatedTerms = objectProperty(
        schema,
        name === "translate-lexical" ? "similarTerms" : "synonyms",
      );
      const relatedTerm = relatedTerms.items;

      expect(relatedTerms).toMatchObject({ maxItems: 3, minItems: 0, type: "array" });
      expect(relatedTerm).toMatchObject({
        additionalProperties: false,
        required: ["meaningZh", "partOfSpeech", "text"],
        type: "object",
      });
      expect(objectProperty(relatedTerm as JsonObject, "partOfSpeech")).toEqual({
        enum: partOfSpeechValues,
        type: "string",
      });
      expect(objectProperty(schema, "collocations")).toMatchObject({
        maxItems: 3,
        minItems: 0,
        type: "array",
      });
    }
    expect(objectProperty(readOutputSchema("explain-lexical"), "coreMeanings")).toMatchObject({
      maxItems: 3,
      minItems: 1,
      type: "array",
    });
  });

  it("accepts the same representative values as the private Zod schemas", () => {
    for (const contractCase of contractCases) {
      expect(contractCase.resultSchema.safeParse(contractCase.value).success).toBe(true);
      expect(validateSubset(readOutputSchema(contractCase.name), contractCase.value)).toEqual([]);
    }
  });

  it("keeps JSON Schema and private Zod acceptance aligned for lexical edge cases", () => {
    const translation = contractCases[0].value;
    const explanation = contractCases[2].value;

    expectSchemaAgreement("translate-lexical", { ...translation, collocations }, true);
    expectSchemaAgreement("translate-lexical", { ...translation, similarTerms: terms }, true);
    expectSchemaAgreement(
      "translate-lexical",
      { ...translation, similarTerms: [...terms, terms[0]] },
      false,
    );
    expectSchemaAgreement(
      "translate-lexical",
      { ...translation, pronunciation: { uk: null } },
      false,
    );
    expectSchemaAgreement(
      "translate-lexical",
      { ...translation, contextExampleTranslationZh: { translationZh: "错误形状" } },
      false,
    );
    expectSchemaAgreement("translate-lexical", { ...translation, sourceText: "Four" }, false);
    expectSchemaAgreement("explain-lexical", { ...explanation, coreMeanings: [] }, false);
    expectSchemaAgreement(
      "explain-lexical",
      {
        ...explanation,
        coreMeanings: [
          ...explanation.coreMeanings,
          ...explanation.coreMeanings,
          ...explanation.coreMeanings,
          ...explanation.coreMeanings,
        ],
      },
      false,
    );
  });
});
