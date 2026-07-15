import { modelProviderSchema, type ModelProvider } from "@huayi/protocol";
import { z } from "zod";

export const providerConfigurationSchema = z.strictObject({
  provider: modelProviderSchema,
  schemaVersion: z.literal(1),
});

export type ProviderConfiguration = z.infer<typeof providerConfigurationSchema>;

export function parseProviderAlias(value: string): ModelProvider {
  if (value === "api") return "openai-responses";
  if (value === "codex") return "codex";
  if (value === "compatible-http") return "openai-compatible-http";
  throw new TypeError("Provider must be api, codex, or compatible-http.");
}
