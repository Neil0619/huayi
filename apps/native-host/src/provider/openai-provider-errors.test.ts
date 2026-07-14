import { describe, expect, it } from "vitest";

import { OpenAICredentialError } from "../credentials/openai-keychain.js";
import {
  mapOpenAIProviderError,
  openAIFetchError,
  openAIHttpError,
  openAIProviderError,
} from "./openai-provider-errors.js";

describe("OpenAI Provider errors", () => {
  it.each([
    ["MODEL_PROVIDER_NOT_CONFIGURED", false],
    ["MODEL_PROVIDER_AUTH_FAILED", true],
    ["RATE_LIMITED", false],
    ["QUOTA_EXCEEDED", false],
    ["NETWORK_ERROR", true],
    ["TIMEOUT", true],
    ["INVALID_RESPONSE", true],
    ["CANCELLED", false],
    ["INTERNAL_ERROR", true],
  ] as const)("maps %s to a fixed safe public error", (code, retryable) => {
    const mapped = mapOpenAIProviderError(openAIProviderError(code, new Error("secret detail")));

    expect(mapped).toMatchObject({ code, retryable });
    expect(mapped.message).not.toContain("secret detail");
  });

  it.each([
    ["MODEL_PROVIDER_NOT_CONFIGURED", "MODEL_PROVIDER_NOT_CONFIGURED"],
    ["MODEL_PROVIDER_AUTH_FAILED", "MODEL_PROVIDER_AUTH_FAILED"],
    ["TIMEOUT", "TIMEOUT"],
    ["CANCELLED", "CANCELLED"],
    ["INTERNAL_ERROR", "INTERNAL_ERROR"],
  ] as const)("maps credential error %s", (credentialCode, expectedCode) => {
    expect(mapOpenAIProviderError(new OpenAICredentialError(credentialCode))).toMatchObject({
      code: expectedCode,
    });
  });

  it.each([
    [400, undefined, "INVALID_RESPONSE"],
    [401, undefined, "MODEL_PROVIDER_AUTH_FAILED"],
    [403, undefined, "MODEL_PROVIDER_AUTH_FAILED"],
    [429, { error: { code: "rate_limit_exceeded" } }, "RATE_LIMITED"],
    [429, { error: { code: "insufficient_quota" } }, "QUOTA_EXCEEDED"],
    [429, { code: "insufficient_quota" }, "RATE_LIMITED"],
    [502, undefined, "NETWORK_ERROR"],
    [503, undefined, "NETWORK_ERROR"],
    [504, undefined, "NETWORK_ERROR"],
    [500, undefined, "INTERNAL_ERROR"],
    [302, undefined, "INVALID_RESPONSE"],
  ] as const)("classifies HTTP %i as %s", (status, body, code) => {
    expect(mapOpenAIProviderError(openAIHttpError(status, body))).toMatchObject({ code });
  });

  it("does not infer quota exhaustion from messages or unknown error-body fields", () => {
    for (const body of [
      { error: { message: "insufficient_quota" } },
      { error: { code: "insufficient_quota", extra: true } },
      { error: { code: 429 } },
      "insufficient_quota",
    ]) {
      expect(mapOpenAIProviderError(openAIHttpError(429, body))).toMatchObject({
        code: "RATE_LIMITED",
      });
    }
  });

  it("distinguishes user cancellation from the internal timeout", () => {
    const failure = new TypeError("fetch failed");
    expect(mapOpenAIProviderError(openAIFetchError(failure, "user"))).toMatchObject({
      code: "CANCELLED",
    });
    expect(mapOpenAIProviderError(openAIFetchError(failure, "timeout"))).toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("maps fetch network and rejected redirect failures without exposing diagnostics", () => {
    const network = openAIFetchError(new TypeError("fetch failed: secret host"), "none");
    const redirect = openAIFetchError(
      new TypeError("fetch failed", { cause: new Error("unexpected redirect to secret host") }),
      "none",
    );

    expect(mapOpenAIProviderError(network)).toMatchObject({ code: "NETWORK_ERROR" });
    expect(mapOpenAIProviderError(redirect)).toMatchObject({ code: "INVALID_RESPONSE" });
    expect(String(network)).not.toContain("secret host");
    expect(String(redirect)).not.toContain("secret host");
  });

  it("fails unknown local errors closed", () => {
    expect(mapOpenAIProviderError(new Error("secret local failure"))).toEqual(
      expect.objectContaining({ code: "INTERNAL_ERROR", retryable: true }),
    );
  });
});
