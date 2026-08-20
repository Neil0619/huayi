import { z } from "zod";

const webEnvironmentSchema = z
  .object({
    VITE_API_ORIGIN: z.url(),
  })
  .strict();

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function parseWebEnvironment(
  environment: Record<string, string | undefined>,
): WebEnvironment {
  return webEnvironmentSchema.parse(environment);
}
