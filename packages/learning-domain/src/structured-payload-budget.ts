import { z } from "zod/v3";
import { isStructuredPayloadWithinBudget } from "./structured-payload-size.js";

// Leave room for the event envelope below the frozen 64 Ki-character analysis reader limit.
// The byte cap also leaves space for previews and repeated terminal snapshots in task streams.
/** Only call with a schema-parsed JSON object, including trusted metadata and candidate IDs. */
export function validateStructuredPayloadBudget(value: object): void {
  if (!isStructuredPayloadWithinBudget(value))
    throw new z.ZodError([
      { code: "custom", path: [], message: "Structured teaching exceeds its payload budget." },
    ]);
}
