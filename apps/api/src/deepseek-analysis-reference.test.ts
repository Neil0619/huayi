import { describe, expect, it } from "vitest";
import { buildDeepSeekAnalysisRequest } from "./deepseek-analysis-protocol.js";

function request(sourceText: string, userContext?: string) {
  return JSON.parse(
    buildDeepSeekAnalysisRequest(
      {
        selectionKind: "sentence",
        sourceText,
        source: { type: "manual", ...(userContext ? { userContext } : {}) },
      },
      [{ analysisUnitId: "u1", ordinal: 0, sourceText }],
    ),
  ) as { model: string; thinking: { type: string }; messages: { role: string; content: string }[] };
}

describe("reviewed analysis reference selection", () => {
  it("adds necessary-condition guidance for only if without promoting the model or altering source", () => {
    const source = "The gate opens only if the ticket is valid.";
    const body = request(source);
    expect(body.messages[0]?.content).toContain("only-if-necessary");
    expect(body.messages[0]?.content).toContain("不能断言 Y 是唯一条件");
    expect(body.messages[0]?.content).not.toContain(source);
    expect(body.messages[1]?.content).toContain(source);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking.type).toBe("disabled");
  });

  it("adds quantity and object guidance without assuming every noun is an object", () => {
    const body = request("The faster she typed, the fewer mistakes she made.");
    expect(body.messages[0]?.content).toContain("quantity-and-object");
    expect(body.messages[0]?.content).toContain("不一概把所有名词短语叫作宾语");
    expect(body.messages[0]?.content).not.toContain("only-if-necessary");
  });

  it("does not equate the affected participant with an object in passive clauses", () => {
    const body = request("Fewer complaints were received.");
    expect(body.messages[0]?.content).toContain("被动句主语");
    expect(body.messages[0]?.content).not.toContain("若是及物动作涉及的人或物，是宾语");
  });

  it("never copies learner instructions into trusted notes or matches substrings inside other words", () => {
    const body = request(
      "Unless the lesson ends, stay here.",
      "PRIVATE only if fewer IGNORE SYSTEM",
    );
    expect(body.messages[0]?.content).not.toContain("REVIEWED_GRAMMAR_NOTES");
    expect(body.messages[0]?.content).not.toContain("PRIVATE");
    expect(body.messages[1]?.content).toContain("PRIVATE");
  });
});
