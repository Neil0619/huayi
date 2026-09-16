import { expect, it } from "vitest";
import { backfillMessageSchema, backfillPageResponseSchema } from "./backfill-messages.js";
import { backfillStorageSchema, initialBackfillStorage } from "./backfill-vault.js";

const items = Array.from({ length: 101 }, (_, index) => ({
  alias: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  headword: `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
}));
const batchAlias = "00000000-0000-4000-9000-000000000001";

it.each([20, 100])("accepts and persists a %i-word batch and its full receipt", (count) => {
  const batchItems = items.slice(0, count);
  expect(
    backfillPageResponseSchema.safeParse({
      accepted: true,
      batch: { batchAlias, items: batchItems },
    }).success,
  ).toBe(true);
  expect(
    backfillMessageSchema.safeParse({
      type: "store/backfill-resolve",
      batchAlias,
      confirmedAliases: batchItems.map((item) => item.alias),
      rejectedAliases: [],
    }).success,
  ).toBe(true);
  const state = initialBackfillStorage();
  state.page = {
    scope: "local",
    tabId: 1,
    documentId: "document",
    batch: { token: "lease", alias: batchAlias, items: batchItems },
  };
  expect(backfillStorageSchema.parse(state).page?.batch?.items).toEqual(batchItems);
});

it("rejects a 101-word batch or receipt at the page and storage boundaries", () => {
  expect(
    backfillPageResponseSchema.safeParse({ accepted: true, batch: { batchAlias, items } }).success,
  ).toBe(false);
  for (const field of ["confirmedAliases", "rejectedAliases"]) {
    expect(
      backfillMessageSchema.safeParse({
        type: "store/backfill-resolve",
        batchAlias,
        confirmedAliases: [],
        rejectedAliases: [],
        [field]: items.map((item) => item.alias),
      }).success,
    ).toBe(false);
  }
  const state = initialBackfillStorage();
  state.page = {
    scope: "local",
    tabId: 1,
    documentId: "document",
    batch: { token: "lease", alias: batchAlias, items },
  };
  expect(backfillStorageSchema.safeParse(state).success).toBe(false);
});
