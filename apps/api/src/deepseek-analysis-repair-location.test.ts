import { describe, expect, it } from "vitest";
import { reportDeepSeekAnalysisOutputInvalid } from "./deepseek-analysis-diagnostics.js";
import { buildDeepSeekAnalysisRequest } from "./deepseek-analysis-protocol.js";
import { contractFixtures } from "@huayi/cloud-contracts";
import type { z } from "zod/v3";

const sourceIssue = (sentence: number, candidate: number): z.ZodIssue => ({
  code: "custom",
  path: ["result", "sentences", sentence, "candidates", candidate, "text"],
  message: "Exact source fragment required.",
});

describe("private repair locations", () => {
  it("identifies each rejected source quote without exposing array positions in diagnostics", () => {
    const diagnostics: unknown[] = [];
    const feedback = reportDeepSeekAnalysisOutputInvalid(
      "content-schema",
      "first",
      [sourceIssue(0, 0), sourceIssue(1, 0)],
      (diagnostic) => diagnostics.push(diagnostic),
    );
    expect(feedback.issues).toEqual([
      {
        path: ["result", "sentences", "*", "candidates", "*", "text"],
        location: ["result", "sentences", 0, "candidates", 0, "text"],
        code: "custom",
        rule: "exact-source-fragment",
      },
      {
        path: ["result", "sentences", "*", "candidates", "*", "text"],
        location: ["result", "sentences", 1, "candidates", 0, "text"],
        code: "custom",
        rule: "exact-source-fragment",
      },
    ]);
    expect(diagnostics).toEqual([
      {
        event: "deepseek_analysis_output_invalid",
        stage: "content-schema",
        attempt: "first",
        issues: [
          {
            path: ["result", "sentences", "*", "candidates", "*", "text"],
            code: "custom",
            rule: "exact-source-fragment",
          },
        ],
        truncated: false,
      },
    ]);
    const body = buildDeepSeekAnalysisRequest(
      contractFixtures.startAnalysisRequest,
      [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      "untrusted prior output",
      feedback,
    );
    const messages = (JSON.parse(body) as { messages: { content: string }[] }).messages;
    expect(messages[2]?.content).toContain(
      '"location":["result","sentences",0,"candidates",0,"text"]',
    );
    expect(messages[2]?.content).toContain("exact-source-fragment");
  });

  it("preserves separate locations for source-backed sentence pattern values", () => {
    const diagnostics: unknown[] = [];
    const detail = reportDeepSeekAnalysisOutputInvalid(
      "output-schema",
      "first",
      [0, 1].map((index) => ({
        code: "invalid_type" as const,
        expected: "string" as const,
        received: "undefined" as const,
        message: "private value",
        path: ["result", "sentences", index, "candidates", 0, "sourceValues", 0, "text"],
      })),
      (diagnostic) => diagnostics.push(diagnostic),
    );
    expect(detail.issues).toHaveLength(2);
    expect(detail.issues.map((issue) => issue.location)).toEqual(
      [0, 1].map((index) => [
        "result",
        "sentences",
        index,
        "candidates",
        0,
        "sourceValues",
        0,
        "text",
      ]),
    );
    expect(JSON.stringify(diagnostics)).not.toMatch(/location|private|redacted/);
    expect(JSON.stringify(diagnostics)).toContain('"sourceValues","*","text"');
  });

  it("never includes unknown keys, unbounded indices or arbitrary refinement text in locations", () => {
    const feedback = reportDeepSeekAnalysisOutputInvalid(
      "content-schema",
      "first",
      [
        { ...sourceIssue(0, 0), path: ["result", "private-key", 0] },
        sourceIssue(1000, 0),
        sourceIssue(-1, 0),
        sourceIssue(1.5, 0),
        { ...sourceIssue(0, 0), message: "Exact source fragment required. private suffix" },
      ],
      () => undefined,
    );
    for (const issue of feedback.issues.slice(0, -1)) expect(issue).not.toHaveProperty("location");
    expect(feedback.issues.at(-1)).not.toHaveProperty("rule");
    expect(JSON.stringify(feedback)).not.toContain("private");
  });

  it("caps separate repair locations and leaves logger failures harmless", () => {
    const feedback = reportDeepSeekAnalysisOutputInvalid(
      "content-schema",
      "repair",
      Array.from({ length: 40 }, (_, index) => sourceIssue(index, 0)),
      () => {
        throw new Error("unavailable");
      },
    );
    expect(feedback.issues).toHaveLength(16);
    expect(feedback.truncated).toBe(true);
  });
});
