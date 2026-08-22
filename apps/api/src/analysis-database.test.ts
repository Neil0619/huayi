import { describe, expect, it } from "vitest";

import { preparePostgresParameters } from "./analysis-database.js";

describe("Postgres analysis database parameters", () => {
  it("decodes exactly the parameters that SQL casts to jsonb", () => {
    const calls = [{ cachedInputTokens: 0, costMicroUsd: 36, inputTokens: 64, outputTokens: 32 }];
    const result = preparePostgresParameters(
      "SELECT settle($1,$2::uuid[],$3::jsonb,$4,$10::jsonb)",
      [
        "plain-text",
        ["10000000-0000-0000-0000-000000000001"],
        JSON.stringify(calls),
        JSON.stringify({ mustRemainText: true }),
        null,
        null,
        null,
        null,
        null,
        JSON.stringify({ terminal: true }),
      ],
    );

    expect(result).toEqual([
      "plain-text",
      ["10000000-0000-0000-0000-000000000001"],
      calls,
      JSON.stringify({ mustRemainText: true }),
      null,
      null,
      null,
      null,
      null,
      { terminal: true },
    ]);
  });

  it("fails closed when a jsonb parameter is not valid JSON", () => {
    expect(() => preparePostgresParameters("SELECT $1::jsonb", ["not-json"])).toThrow(
      "Invalid JSONB database parameter.",
    );
  });
});
