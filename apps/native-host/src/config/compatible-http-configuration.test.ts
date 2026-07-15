import { describe, expect, it } from "vitest";

import { compatibleHttpConfigurationSchema } from "./compatible-http-configuration.js";

const mini = {
  allowInsecureHttp: true,
  baseUrl: "http://101.133.153.118:9090/v1",
  effort: "low",
  model: "gpt-5.4-mini",
  schemaVersion: 1,
} as const;

describe("compatibleHttpConfigurationSchema", () => {
  it("accepts only the two fixed model and effort combinations", () => {
    expect(compatibleHttpConfigurationSchema.parse(mini)).toEqual(mini);
    expect(
      compatibleHttpConfigurationSchema.parse({
        ...mini,
        effort: "none",
        model: "gpt-5.6-luna",
      }),
    ).toMatchObject({ effort: "none", model: "gpt-5.6-luna" });
  });

  it.each([
    ["HTTPS", "https://example.test/v1"],
    ["credentials", "http://user:password@example.test/v1"],
    ["query", "http://example.test/v1?tenant=test"],
    ["empty query", "http://example.test/v1?"],
    ["fragment", "http://example.test/v1#section"],
    ["empty fragment", "http://example.test/v1#"],
    ["responses suffix", "http://example.test/v1/responses"],
    ["trailing slash", "http://example.test/v1/"],
    ["relative URL", "/v1"],
  ])("rejects a base URL with %s", (_description, baseUrl) => {
    expect(() => compatibleHttpConfigurationSchema.parse({ ...mini, baseUrl })).toThrow();
  });

  it("allows only URL's host-only root-slash normalization", () => {
    expect(
      compatibleHttpConfigurationSchema.parse({ ...mini, baseUrl: "http://example.test" }),
    ).toMatchObject({ baseUrl: "http://example.test" });

    for (const baseUrl of [
      "http://example.test/",
      "HTTP://example.test/v1",
      "http://EXAMPLE.test/v1",
      "http://example.test:80/v1",
      "http://%65xample.test/v1",
      "http://example.test/a/../v1",
      "http://example.test/v 1",
    ]) {
      expect(() => compatibleHttpConfigurationSchema.parse({ ...mini, baseUrl })).toThrow();
    }
  });

  it.each([
    ["unknown model", { model: "gpt-5.5" }],
    ["mini with none", { effort: "none" }],
    ["luna with low", { model: "gpt-5.6-luna" }],
    ["missing HTTP acknowledgement", { allowInsecureHttp: false }],
    ["unknown field", { provider: "codex" }],
    ["schema version 2", { schemaVersion: 2 }],
  ])("rejects %s", (_description, override) => {
    expect(() => compatibleHttpConfigurationSchema.parse({ ...mini, ...override })).toThrow();
  });
});
