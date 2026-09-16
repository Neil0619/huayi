import { z } from "zod/v3";
import { BACKFILL_ERROR_CODES } from "./backfill-errors.js";

export const backfillErrorResponseSchema = z.strictObject({
  code: z.enum(BACKFILL_ERROR_CODES),
  error: z.string().max(300),
});
