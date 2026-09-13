import { expect, it } from "vitest";
import {
  practiceReferenceRequestSchema,
  practiceReferenceResultSchema,
} from "./practice-reference.js";

it("requests a reference using server-owned practice identity, without an answer or target", () => {
  const input = { expectedRevision: 2, expectedControlRevision: 0, ordinal: 0 };
  expect(practiceReferenceRequestSchema.parse(input)).toEqual(input);
  expect(practiceReferenceRequestSchema.safeParse({ ...input, prompt: "Override" }).success).toBe(
    false,
  );
  expect(practiceReferenceRequestSchema.safeParse({ ...input, answer: "My draft" }).success).toBe(
    false,
  );
});

it("requires a bounded English reference with Chinese translation and usage guidance", () => {
  const example = {
    sentence: "Please allow at least two days for the report.",
    translationZh: "请为报告至少预留两天。",
    usageNoteZh: "at least 用来说明最低限度。",
  };
  expect(practiceReferenceResultSchema.parse(example)).toEqual(example);
  for (const sentence of ["", "{subject} needs {time}.", "请给我两天。"])
    expect(practiceReferenceResultSchema.safeParse({ ...example, sentence }).success).toBe(false);
});
