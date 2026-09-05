import { describe, expect, it } from "vitest";
import type { ExtensionQueryRequest } from "@huayi/cloud-contracts";
import { deepSeekQueryExample } from "./deepseek-output-examples.js";
import { createQueryOutputContract, reportQueryOutputFailure } from "./extension-query-output.js";

const generationId = "00000000-0000-4000-8000-000000000001";
const kinds = ["word", "phrase", "sentence", "passage"] as const;
const actions = ["translate", "explain"] as const;

function example(input: ExtensionQueryRequest) {
  const contract = createQueryOutputContract(input);
  const match = deepSeekQueryExample(contract.type, input.selectionKind).match(
    /EXAMPLE_JSON_OUTPUT\n(.+)\nEND_EXAMPLE_JSON_OUTPUT/u,
  );
  if (!match?.[1]) throw new Error("Missing example fixture.");
  return { contract, output: JSON.parse(match[1]) as Record<string, unknown> };
}
const wordInput: ExtensionQueryRequest = {
  action: "translate",
  selectionKind: "word",
  sourceType: "web-selection",
  sourceText: "example",
};

describe("extension query output contract", () => {
  it.each(kinds.flatMap((selectionKind) => actions.map((action) => ({ selectionKind, action }))))(
    "keeps $action $selectionKind examples valid and binds the exact request type",
    ({ selectionKind, action }) => {
      const input: ExtensionQueryRequest = {
        action,
        selectionKind,
        sourceType: "web-selection",
        sourceText: "example",
      };
      const { contract, output } = example(input);
      expect(contract.parse(JSON.stringify(output), generationId)).toMatchObject({
        success: true,
        data: {
          type: contract.type,
          selectionKind,
          sourceText: "example",
          requestId: generationId,
        },
      });
      expect(contract.instructions).toContain(
        `"selectionKind":{"type":"string","const":"${selectionKind}"}`,
      );
      for (const forbidden of ["requestId", "sourceText", "generationId", "https://"])
        expect(contract.instructions).not.toContain(forbidden);
    },
  );

  it("distinguishes language refinements and empty pronunciation without logging rejected values", () => {
    const { contract, output } = example(wordInput);
    const parsed = contract.parse(
      JSON.stringify({
        ...output,
        dictionaryForm: "私密内容",
        contextualSense: { meaningZh: "PRIVATE_MEANING", partOfSpeech: "noun" },
        pronunciation: {},
      }),
      generationId,
    );
    expect(parsed).toEqual({
      success: false,
      failure: {
        stage: "schema",
        issuesTruncated: false,
        issues: [
          { path: "contextualSense.meaningZh", code: "chinese_text_required" },
          { path: "dictionaryForm", code: "english_text_required" },
          { path: "dictionaryForm", code: "english_text_required" },
          { path: "pronunciation", code: "pronunciation_required" },
        ],
      },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/私密|PRIVATE_MEANING/u);
  });

  it("retains strict list and text bounds instead of accepting an overlong partial result", () => {
    const { contract, output } = example(wordInput);
    const parsed = contract.parse(
      JSON.stringify({
        ...output,
        dictionaryForm: "x".repeat(121),
        commonMeanings: [],
        commonPhrases: Array.from({ length: 5 }, () => ({
          text: "for example",
          meaningZh: "例如",
        })),
      }),
      generationId,
    );
    expect(parsed).toMatchObject({
      success: false,
      failure: {
        issues: [
          { path: "commonMeanings", code: "too_small" },
          { path: "commonPhrases", code: "too_big" },
          { path: "dictionaryForm", code: "too_big" },
        ],
      },
    });
  });

  it("omits unexpected generation identifiers and isolates diagnostics from repair feedback", () => {
    const { contract } = example(wordInput);
    const parsed = contract.parse('{"UNKNOWN_MODEL_KEY":null}', generationId);
    if (parsed.success) throw new Error("Expected invalid fixture.");
    const before = JSON.stringify(parsed.failure);
    let logged: unknown;
    reportQueryOutputFailure(
      parsed.failure,
      contract.type,
      "https://PRIVATE_IDENTIFIER",
      "initial",
      (record) => {
        logged = JSON.parse(JSON.stringify(record));
        Object.assign(record.issues[0] ?? {}, { path: "PRIVATE_DIAGNOSTIC_MUTATION" });
      },
    );
    expect(JSON.stringify(logged)).not.toMatch(/UNKNOWN_MODEL_KEY|PRIVATE_IDENTIFIER|https:\/\//u);
    expect(JSON.stringify(parsed.failure)).toBe(before);
  });
});
