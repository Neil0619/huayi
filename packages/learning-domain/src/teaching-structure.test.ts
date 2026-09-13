import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import {
  assembleSentenceStructure,
  validateSentenceStructureSource,
  type SentenceStructureDraft,
} from "./teaching-structure.js";

const group = (...texts: string[]) => ({
  explanationZh: "说明原文中的作用。",
  fragments: texts.map((text) => ({ text, occurrence: 1 })),
});
const modifier = (target: { kind: "core" | "modifier"; index: number }, ...texts: string[]) => ({
  ...group(...texts),
  relation: "relative-clause" as const,
  target,
});
const source = "The book that I bought arrived.";
function draft(): SentenceStructureDraft {
  return {
    kind: "sentence",
    coreClauses: [group("The book", "arrived")],
    modifiers: [modifier({ kind: "core", index: 0 }, "that I bought")],
  };
}

describe("sentence teaching source boundary", () => {
  it("retains discontinuous main clauses and maps the modifier to a trusted target", () => {
    const structure = assembleSentenceStructure(source, draft());
    expect(structure).toEqual({
      kind: "sentence",
      coreClauses: [
        {
          explanationZh: "说明原文中的作用。",
          fragments: [
            { text: "The book", start: 0, end: 8 },
            { text: "arrived", start: 23, end: 30 },
          ],
        },
      ],
      modifiers: [
        {
          explanationZh: "说明原文中的作用。",
          fragments: [{ text: "that I bought", start: 9, end: 22 }],
          relation: "relative-clause",
          target: { kind: "core", index: 0 },
        },
      ],
    });
    expect(validateSentenceStructureSource(source, structure)).toEqual(structure);
  });

  it("represents a fragment without inventing a full sentence", () => {
    expect(
      assembleSentenceStructure("In the quiet room", {
        kind: "fragment",
        coreClauses: [group("In the quiet room")],
        modifiers: [],
      }),
    ).toMatchObject({
      kind: "fragment",
      coreClauses: [
        {
          fragments: [{ text: "In the quiet room", start: 0, end: 17 }],
        },
      ],
    });
  });

  it("supports multiple main clauses and a detached introductory modifier", () => {
    expect(
      assembleSentenceStructure("Today, we stay; they leave.", {
        kind: "sentence",
        coreClauses: [group("we stay"), group("they leave")],
        modifiers: [{ ...modifier({ kind: "core", index: 0 }, "Today"), relation: "adverbial" }],
      }).coreClauses,
    ).toHaveLength(2);
  });

  it("supports nested modifiers without imposing order across different groups", () => {
    const nested = {
      kind: "sentence",
      coreClauses: [group("A", "F")],
      modifiers: [
        modifier({ kind: "modifier", index: 1 }, "C", "D"),
        modifier({ kind: "core", index: 0 }, "B", "E"),
      ],
    };
    expect(assembleSentenceStructure("A B C D E F", nested).modifiers).toHaveLength(2);
  });

  it("does not relocate repeated words to the first matching occurrence", () => {
    const structure = assembleSentenceStructure("😀we can; we can.", {
      kind: "sentence",
      coreClauses: [
        group("we can"),
        {
          ...group("we can"),
          fragments: [{ text: "we can", occurrence: 2 }],
        },
      ],
      modifiers: [],
    });
    expect(structure.coreClauses.map((core) => core.fragments)).toEqual([
      [{ text: "we can", start: 2, end: 8 }],
      [{ text: "we can", start: 10, end: 16 }],
    ]);
  });

  it("rejects nonexistent, self-referencing and cyclic modifier targets", () => {
    for (const modifiers of [
      [modifier({ kind: "core", index: 1 }, "B")],
      [modifier({ kind: "modifier", index: 1 }, "B")],
      [modifier({ kind: "modifier", index: 0 }, "B")],
      [
        modifier({ kind: "modifier", index: 1 }, "B"),
        modifier({ kind: "modifier", index: 0 }, "C"),
      ],
    ])
      expect(() =>
        assembleSentenceStructure("A B C", {
          kind: "sentence",
          coreClauses: [group("A")],
          modifiers,
        }),
      ).toThrow(z.ZodError);
  });

  it("rejects crossing group envelopes while allowing source gaps", () => {
    expect(() =>
      assembleSentenceStructure("A B C D E F", {
        kind: "sentence",
        coreClauses: [group("A", "D")],
        modifiers: [modifier({ kind: "core", index: 0 }, "C", "F")],
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects unordered or overlapping main clauses", () => {
    for (const coreClauses of [
      [group("C"), group("A")],
      [group("A", "C"), group("B")],
      [group("A"), group("A")],
    ])
      expect(() =>
        assembleSentenceStructure("A B C", {
          kind: "sentence",
          coreClauses,
          modifiers: [],
        }),
      ).toThrow(z.ZodError);
  });

  it("rejects a reordered group or text invented in another sentence", () => {
    for (const coreClauses of [
      [group("arrived", "The book")],
      [group("The book", "left")],
      [group("The book arrived")],
    ])
      expect(() =>
        assembleSentenceStructure(source, {
          ...draft(),
          coreClauses,
        }),
      ).toThrow(z.ZodError);
  });

  it("rejects trusted fields, bad relationships and unbounded model shape", () => {
    for (const value of [
      { ...draft(), sourceText: source },
      { ...draft(), analysisUnitId: "u1" },
      { ...draft(), kind: "paragraph" },
      { ...draft(), coreClauses: [] },
      { ...draft(), coreClauses: Array.from({ length: 9 }, () => group("The book")) },
      {
        ...draft(),
        modifiers: Array.from({ length: 13 }, () =>
          modifier({ kind: "core", index: 0 }, "that I bought"),
        ),
      },
      { ...draft(), coreClauses: [{ ...group("The book"), explanationZh: "English only" }] },
      { ...draft(), coreClauses: [{ ...group("The book"), explanationZh: "字".repeat(501) }] },
      {
        ...draft(),
        coreClauses: [
          { ...group("The book"), fragments: [{ text: "The book", occurrence: 1, start: 0 }] },
        ],
      },
      {
        ...draft(),
        modifiers: [
          { ...modifier({ kind: "core", index: 0 }, "that I bought"), relation: "arbitrary" },
        ],
      },
    ])
      expect(() => assembleSentenceStructure(source, value)).toThrow(z.ZodError);
  });

  it("revalidates stored positions and relationships without trusting previous assembly", () => {
    const structure = assembleSentenceStructure(source, draft());
    const core = structure.coreClauses[0];
    const detail = structure.modifiers[0];
    if (!core || !detail) throw new Error("Expected teaching groups");
    for (const changed of [
      {
        ...structure,
        coreClauses: [{ ...core, fragments: [{ text: "The book", start: 1, end: 9 }] }],
      },
      { ...structure, modifiers: [{ ...detail, target: { kind: "core", index: 5 } }] },
      { ...structure, modifiers: [{ ...detail, target: { kind: "modifier", index: 0 } }] },
      {
        ...structure,
        coreClauses: [
          { ...core, fragments: [{ text: "The book", start: 0, end: 8, occurrence: 1 }] },
        ],
      },
    ])
      expect(() => validateSentenceStructureSource(source, changed)).toThrow(z.ZodError);
    expect(() => validateSentenceStructureSource(source.toUpperCase(), structure)).toThrow(
      z.ZodError,
    );
  });
});
