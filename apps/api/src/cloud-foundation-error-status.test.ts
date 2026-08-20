import { expect, it } from "vitest";

import { errorStatus } from "./cloud-foundation-app.js";

it("maps domain conflicts and client upgrades to their HTTP status", () => {
  expect(errorStatus("revision_conflict")).toBe(409);
  expect(errorStatus("learning_item_in_use")).toBe(409);
  expect(errorStatus("learning_item_must_be_archived")).toBe(409);
  expect(errorStatus("practice_session_in_use")).toBe(409);
  expect(errorStatus("word_entry_in_use")).toBe(409);
  expect(errorStatus("sign_in_method_already_linked")).toBe(409);
  expect(errorStatus("client_upgrade_required")).toBe(426);
  expect(errorStatus("generation_busy")).toBe(409);
  expect(errorStatus("quota_exhausted")).toBe(429);
  expect(errorStatus("model_output_invalid")).toBe(502);
});
