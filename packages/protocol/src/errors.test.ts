import { describe, expect, it } from "vitest";

import { analysisErrorSchema, errorCodeSchema } from "./index.js";

const expectedCodes = [
  "HOST_NOT_INSTALLED",
  "CODEX_NOT_AUTHENTICATED",
  "CODEX_CAPABILITY_MISSING",
  "MODEL_PROVIDER_NOT_CONFIGURED",
  "MODEL_PROVIDER_AUTH_FAILED",
  "EUDIC_NOT_CONFIGURED",
  "EUDIC_AUTH_FAILED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "INVALID_RESPONSE",
  "CANCELLED",
  "UNSUPPORTED_SELECTION",
  "INTERNAL_ERROR",
] as const;

describe("errorCodeSchema", () => {
  it("accepts exactly the public error codes", () => {
    expect(errorCodeSchema.parse("MODEL_PROVIDER_NOT_CONFIGURED")).toBe(
      "MODEL_PROVIDER_NOT_CONFIGURED",
    );
    expect(errorCodeSchema.parse("MODEL_PROVIDER_AUTH_FAILED")).toBe("MODEL_PROVIDER_AUTH_FAILED");

    for (const code of expectedCodes) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }

    expect(errorCodeSchema.options).toEqual(expectedCodes);
    expect(errorCodeSchema.safeParse("SHELL_FAILED").success).toBe(false);
  });
});

describe("analysisErrorSchema", () => {
  it("accepts a safe user-facing error", () => {
    const error = {
      code: "TIMEOUT",
      message: "处理超时，请重试。",
      retryable: true,
    } as const;

    expect(analysisErrorSchema.parse(error)).toEqual(error);
  });

  it("rejects unknown fields", () => {
    expect(
      analysisErrorSchema.safeParse({
        code: "INTERNAL_ERROR",
        debugStack: "secret local path",
        message: "处理失败。",
        retryable: false,
      }).success,
    ).toBe(false);
  });
});
