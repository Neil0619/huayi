import { describe, expect, it } from "vitest";

import { CodexProviderError, mapCodexError, mapCodexProcessFailure } from "./error-mapper.js";

describe("Codex error mapping", () => {
  it.each([
    ["not logged in", "CODEX_NOT_AUTHENTICATED", false],
    ["429 too many requests", "RATE_LIMITED", true],
    ["usage limit reached", "QUOTA_EXCEEDED", false],
    ["network connection reset", "NETWORK_ERROR", true],
  ] as const)("maps stderr %s", (stderr, code, retryable) => {
    expect(mapCodexProcessFailure({ exitCode: 1, stderr })).toMatchObject({ code, retryable });
  });

  it("maps abort and timeout without exposing process diagnostics", () => {
    expect(mapCodexProcessFailure({ aborted: true, exitCode: null, stderr: "secret" })).toEqual(
      expect.objectContaining({ code: "CANCELLED", retryable: false }),
    );
    expect(mapCodexProcessFailure({ exitCode: null, stderr: "secret", timedOut: true })).toEqual(
      expect.objectContaining({ code: "TIMEOUT", retryable: true }),
    );
  });

  it("preserves typed provider failures for dispatcher output", () => {
    const error = new CodexProviderError("INVALID_RESPONSE", "模型返回了无效结果，请重试。", true);

    expect(mapCodexError(error)).toEqual({
      code: "INVALID_RESPONSE",
      message: "模型返回了无效结果，请重试。",
      retryable: true,
    });
  });

  it("fails unknown errors closed with a generic message", () => {
    expect(mapCodexError(new Error("/Users/me/.codex/auth.json leaked"))).toEqual({
      code: "INTERNAL_ERROR",
      message: "本机模型服务处理失败，请重试。",
      retryable: true,
    });
  });
});
