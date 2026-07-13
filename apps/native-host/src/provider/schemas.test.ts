import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  lexicalExplanationResultSchema,
  lexicalTranslationResultSchema,
  passageTranslationResultSchema,
  sentenceExplanationResultSchema,
} from "@huayi/protocol";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

const outputSchemaNames = [
  "translate-lexical",
  "translate-passage",
  "explain-lexical",
  "explain-sentence",
] as const;

const expectedRequiredProperties = {
  "explain-lexical": [
    "baseForm",
    "collocations",
    "contextualMeaningZh",
    "coreMeanings",
    "selectionKind",
    "sourceText",
    "synonyms",
    "type",
    "wordFormation",
  ],
  "explain-sentence": [
    "contextRole",
    "keyExpressions",
    "mainStructure",
    "selectionKind",
    "sourceText",
    "translationZh",
    "type",
  ],
  "translate-lexical": [
    "collocations",
    "contextExample",
    "contextualMeaningZh",
    "partOfSpeech",
    "pronunciation",
    "selectionKind",
    "similarTerms",
    "sourceText",
    "type",
  ],
  "translate-passage": ["selectionKind", "sourceText", "translationZh", "type"],
} as const;

const expectedStreamPropertyPrefixes = {
  "explain-lexical": ["contextualMeaningZh"],
  "explain-sentence": ["mainStructure", "translationZh", "contextRole"],
  "translate-lexical": ["contextualMeaningZh"],
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

function readOutputSchema(name: (typeof outputSchemaNames)[number]): JsonObject {
  const path = fileURLToPath(new URL(`./schemas/${name}.json`, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

  if (!isJsonObject(parsed)) {
    throw new Error(`${name}.json must contain a JSON object.`);
  }

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
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectObjectSchemas(item));
  }
  if (!isJsonObject(value)) {
    return [];
  }

  const nested = Object.values(value).flatMap((item) => collectObjectSchemas(item));
  return value.type === "object" ? [value, ...nested] : nested;
}

function collectPatterns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPatterns(item));
  }
  if (!isJsonObject(value)) {
    return [];
  }

  const current = typeof value.pattern === "string" ? [value.pattern] : [];
  return [...current, ...Object.values(value).flatMap((item) => collectPatterns(item))];
}

function validateSubset(schemaValue: unknown, value: unknown, path = "$"): string[] {
  if (!isJsonObject(schemaValue)) {
    return [`${path}: schema is not an object`];
  }

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
    if (!matches) {
      errors.push(`${path}: value does not match anyOf`);
    }
  }
  if (Array.isArray(schemaValue.required) && isJsonObject(value)) {
    for (const requiredName of schemaValue.required) {
      if (typeof requiredName === "string" && !(requiredName in value)) {
        errors.push(`${path}: missing ${requiredName}`);
      }
    }
  }

  if (schemaValue.type === "string") {
    if (typeof value !== "string") {
      return [...errors, `${path}: expected string`];
    }
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
    if (!Array.isArray(value)) {
      return [...errors, `${path}: expected array`];
    }
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
    if (!isJsonObject(value)) {
      return [...errors, `${path}: expected object`];
    }

    const properties = isJsonObject(schemaValue.properties) ? schemaValue.properties : {};
    if (schemaValue.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!(name in properties)) {
          errors.push(`${path}: unknown property ${name}`);
        }
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
    resultSchema: lexicalTranslationResultSchema,
    value: {
      collocations,
      contextExample: {
        english: "The investigation was in its early stages.",
        translationZh: "调查仍处于早期阶段。",
      },
      contextualMeaningZh: "对案件进行系统查证的调查",
      partOfSpeech: "noun",
      pronunciation: { uk: "/ɪnˌvestɪˈɡeɪʃn/" },
      selectionKind: "word",
      similarTerms: terms,
      sourceText: "investigation",
      type: "translate-lexical",
    },
  },
  {
    name: "translate-passage",
    resultSchema: passageTranslationResultSchema,
    value: {
      selectionKind: "paragraph",
      sourceText: "First sentence.\nSecond sentence.",
      translationZh: "第一句。\n第二句。",
      type: "translate-passage",
    },
  },
  {
    name: "explain-lexical",
    resultSchema: lexicalExplanationResultSchema,
    value: {
      baseForm: "sustain",
      collocations,
      contextualMeaningZh: "持续的、长时间延续的",
      coreMeanings: [{ meaningZh: "维持；使持续", partOfSpeech: "verb" }],
      selectionKind: "phrase",
      sourceText: "sustained heatwave",
      synonyms: terms,
      type: "explain-lexical",
      wordFormation: "sustain + -ed",
    },
  },
  {
    name: "explain-sentence",
    resultSchema: sentenceExplanationResultSchema,
    value: {
      contextRole: "说明调查阶段并发出征集线索的呼吁。",
      keyExpressions: [{ meaningZh: "处于早期阶段", text: "in its early stages" }],
      mainStructure: "He said ... and urged anyone ...",
      selectionKind: "sentence",
      sourceText: "He said the investigation was in its early stages.",
      translationZh: "他说调查仍处于早期阶段。",
      type: "explain-sentence",
    },
  },
] as const;

describe("Codex output schemas", () => {
  it("places streamable fields before model-only result fields", () => {
    for (const name of outputSchemaNames) {
      const properties = readOutputSchema(name).properties;
      if (!isJsonObject(properties)) {
        throw new Error(`${name}.json must define object properties.`);
      }

      expect(Object.keys(properties).slice(0, expectedStreamPropertyPrefixes[name].length)).toEqual(
        expectedStreamPropertyPrefixes[name],
      );
    }
  });

  it("defines one strict root object for every protocol result variant", () => {
    for (const name of outputSchemaNames) {
      const schema = readOutputSchema(name);

      expect(schema).toMatchObject({
        additionalProperties: false,
        required: expectedRequiredProperties[name],
        type: "object",
      });
      expect(objectProperty(schema, "type")).toEqual({ const: name, type: "string" });
    }
  });

  it("closes every nested object against model-added fields", () => {
    for (const name of outputSchemaNames) {
      for (const objectSchema of collectObjectSchemas(readOutputSchema(name))) {
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

  it("uses the protocol enums and collection limits for lexical results", () => {
    for (const name of ["translate-lexical", "explain-lexical"] as const) {
      const schema = readOutputSchema(name);
      const relatedTerms = objectProperty(
        schema,
        name === "translate-lexical" ? "similarTerms" : "synonyms",
      );
      const relatedTerm = relatedTerms.items;

      expect(relatedTerms).toMatchObject({ maxItems: 5, minItems: 3, type: "array" });
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
        maxItems: 4,
        minItems: 2,
        type: "array",
      });
    }
  });

  it("accepts the same representative values as the protocol Zod schemas", () => {
    for (const contractCase of contractCases) {
      expect(contractCase.resultSchema.safeParse(contractCase.value).success).toBe(true);
      expect(validateSubset(readOutputSchema(contractCase.name), contractCase.value)).toEqual([]);
    }
  });

  it("keeps strict objects while the model schema retains its current term minimum", () => {
    const schema = readOutputSchema("translate-lexical");
    const valid = contractCases[0].value;

    const unknownField = { ...valid, unsafeHtml: "<img src=x onerror=alert(1)>" };
    const tooFewTerms = { ...valid, similarTerms: terms.slice(0, 2) };
    const emptyPronunciation = { ...valid, pronunciation: {} };

    for (const value of [unknownField, emptyPronunciation]) {
      expect(lexicalTranslationResultSchema.safeParse(value).success).toBe(false);
      expect(validateSubset(schema, value)).not.toEqual([]);
    }
    expect(lexicalTranslationResultSchema.safeParse(tooFewTerms).success).toBe(true);
    expect(validateSubset(schema, tooFewTerms)).not.toEqual([]);
  });
});
