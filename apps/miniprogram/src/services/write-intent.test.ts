import { expect, it } from "vitest";
import { createWriteIntents } from "./write-intent";
it("replays uncertain writes but lets a confirmed export or practice start be requested again", () => {
  const values = new Map<string, unknown>();
  let next = 0;
  const intents = createWriteIntents(
    {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value);
      },
      remove: (key) => {
        values.delete(key);
      },
    },
    () => String(++next),
  );
  const original = intents.key("start", { itemId: "one" });
  expect(intents.key("start", { itemId: "one" })).toBe(original);
  const later = intents.key("start", { itemId: "two" });
  intents.acknowledge("start", original);
  expect(intents.key("start", { itemId: "two" })).toBe(later);
  intents.acknowledge("start", later);
  expect(intents.key("start", { itemId: "two" })).not.toBe(later);
});
