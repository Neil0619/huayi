import { describe, expect, it } from "vitest";

import { parseProviderAlias, providerConfigurationSchema } from "./provider-configuration.js";

describe("providerConfigurationSchema", () => {
  it("accepts only schema version 1 and the strict provider shape", () => {
    const valid = { provider: "openai-responses", schemaVersion: 1 } as const;

    expect(providerConfigurationSchema.parse(valid)).toEqual(valid);
    expect(() => providerConfigurationSchema.parse({ ...valid, endpoint: "x" })).toThrow();
    expect(() => providerConfigurationSchema.parse({ ...valid, provider: "other" })).toThrow();
    expect(() => providerConfigurationSchema.parse({ ...valid, schemaVersion: 2 })).toThrow();
  });
});

describe("parseProviderAlias", () => {
  it("maps only the public provider CLI aliases", () => {
    expect(parseProviderAlias("api")).toBe("openai-responses");
    expect(parseProviderAlias("codex")).toBe("codex");
    expect(parseProviderAlias("compatible-http")).toBe("openai-compatible-http");
    expect(parseProviderAlias("deepseek")).toBe("deepseek-chat-completions");
    expect(() => parseProviderAlias("openai-responses")).toThrow();
  });
});
