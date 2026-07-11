import { z } from "zod";

import { analysisErrorSchema } from "./errors.js";
import { SCHEMA_VERSION } from "./limits.js";
import { requestIdSchema } from "./requests.js";
import { analysisResultSchema } from "./results.js";

const schemaVersionSchema = z.literal(SCHEMA_VERSION);

export const healthResultEventSchema = z.strictObject({
  codexVersion: z.string().trim().min(1).max(120),
  hostVersion: z.string().trim().min(1).max(40),
  ready: z.literal(true),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("health-result"),
});
export type HealthResultEvent = z.infer<typeof healthResultEventSchema>;

export const progressEventSchema = z.strictObject({
  elapsedMs: z.number().int().nonnegative().optional(),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  stage: z.enum(["queued", "running"]),
  type: z.literal("progress"),
});
export type ProgressEvent = z.infer<typeof progressEventSchema>;

export const resultEventSchema = z.strictObject({
  requestId: requestIdSchema,
  result: analysisResultSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("result"),
});
export type ResultEvent = z.infer<typeof resultEventSchema>;

export const errorEventSchema = z.strictObject({
  error: analysisErrorSchema,
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("error"),
});
export type ErrorEvent = z.infer<typeof errorEventSchema>;

export const hostEventSchema = z.discriminatedUnion("type", [
  healthResultEventSchema,
  progressEventSchema,
  resultEventSchema,
  errorEventSchema,
]);
export type HostEvent = z.infer<typeof hostEventSchema>;
