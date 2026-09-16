import { z } from "zod/v3";

// The vault encrypts these mappings. Only their random aliases leave the worker.
export const backfillPageReviewStateSchema = z.strictObject({
  identity: z.string(),
  revision: z.number().int().nonnegative(),
  update: z.number().int().nonnegative().default(0),
  sources: z.array(z.strictObject({ alias: z.string().uuid(), source: z.string() })).max(100),
  unknownBatches: z.array(z.strictObject({ alias: z.string().uuid(), token: z.string() })).max(100),
  cursor: z.strictObject({ alias: z.string().uuid(), value: z.string().max(202) }).nullable(),
});
