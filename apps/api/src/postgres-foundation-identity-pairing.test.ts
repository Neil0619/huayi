import type { Sql, TransactionSql } from "postgres";
import { describe, expect, it } from "vitest";

import { createPostgresFoundationIdentity } from "./postgres-foundation-identity.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

describe("Postgres foundation identity pairing", () => {
  it("returns the extension preference snapshot from the atomic exchange statement", async () => {
    const statements: string[] = [];
    const transaction = (async (parts: TemplateStringsArray) => {
      const statement = parts.join("?").replaceAll(/\s+/gu, " ").trim();
      statements.push(statement);
      if (statement === "SET LOCAL ROLE huayi_context_setter") return [];
      if (statement.includes("FROM exchange_extension_pairing(")) {
        return [
          {
            cloud_word_copy_mode: "enabled",
            extension_query_model_mode: "byok",
            id: "23000000-0000-0000-0000-000000000001",
            preferences_revision: 4,
            preferences_updated_at: new Date("2026-08-22T02:00:00.000Z"),
            study_capture_mode: "automatic",
          },
        ];
      }
      throw new Error("Pairing exchange issued an unexpected follow-up query.");
    }) as unknown as TransactionSql;
    const sql = Object.assign(() => Promise.resolve([]), {
      begin: async <Result>(operation: (transaction: TransactionSql) => Promise<Result>) =>
        operation(transaction),
    }) as unknown as Sql;
    const identity = createPostgresFoundationIdentity({
      clock: new MutableClock("2026-08-22T02:00:00.000Z"),
      pepper: "pairing-test-pepper-with-at-least-thirty-two-characters",
      protectRefreshToken: (value) => value,
      secrets: new DeterministicSecrets(),
      sql,
      webOrigin: "https://app.example.test",
    });

    await expect(
      identity.exchangeExtensionPairing(
        "22000000-0000-0000-0000-000000000001",
        "s".repeat(32),
        "a".repeat(43),
      ),
    ).resolves.toMatchObject({
      preferences: {
        cloudWordCopyMode: "enabled",
        extensionQueryModelMode: "byok",
        revision: 4,
        studyCaptureMode: "automatic",
        updatedAt: "2026-08-22T02:00:00.000Z",
      },
    });
    expect(statements).toHaveLength(2);
    expect(statements[1]).not.toContain("FROM user_profiles");
  });
});
