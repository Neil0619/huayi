import { describe, expect, it } from "vitest";

import { CompatibleHttpConfigurationError } from "../config/compatible-http-configuration-store.js";
import { CompatibleHttpCredentialError } from "../credentials/compatible-http-keychain.js";
import { OpenAICredentialError } from "../credentials/openai-keychain.js";
import { compatibleHttpProviderError } from "../provider/compatible-http-provider-errors.js";
import { openAIHttpError, openAIProviderError } from "../provider/openai-provider-errors.js";
import { ProviderValidationError } from "../provider/provider-validation.js";
import {
  CodexProviderError,
  mapAnalysisProviderError,
  mapCodexError,
  mapCodexProcessFailure,
  mapCodexTurnFailure,
  mapProviderValidationFailure,
} from "./error-mapper.js";

describe("Codex error mapping", () => {
  it.each([
    ["not logged in", "CODEX_NOT_AUTHENTICATED", false],
    ["429 too many requests", "RATE_LIMITED", true],
    ["usage limit reached", "QUOTA_EXCEEDED", false],
    ["network connection reset", "NETWORK_ERROR", true],
    ["invalid_json_schema: regex lookaround is not supported", "CODEX_CAPABILITY_MISSING", false],
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

  it.each([
    [{ message: "429 too many requests" }, "RATE_LIMITED", true],
    [{ error: { message: "usage limit reached" } }, "QUOTA_EXCEEDED", false],
    [{ details: "network connection reset" }, "NETWORK_ERROR", true],
  ] as const)("maps App Server turn failures", (failure, code, retryable) => {
    expect(mapCodexTurnFailure(failure)).toMatchObject({ code, retryable });
  });

  it("fails unknown App Server failures closed without exposing their text", () => {
    expect(mapCodexTurnFailure({ message: "/Users/me/.codex/auth.json prompt secret" })).toEqual(
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: expect.not.stringContaining("auth.json"),
        retryable: true,
      }),
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

  it.each([
    ["stream-parse", "INVALID_RESPONSE"],
    ["model-json", "INVALID_RESPONSE"],
    ["model-schema", "INVALID_RESPONSE"],
    ["result-assembly", "INTERNAL_ERROR"],
    ["protocol-validation", "INTERNAL_ERROR"],
  ] as const)("maps %s to retryable %s", (stage, code) => {
    const error = mapProviderValidationFailure(
      new ProviderValidationError(stage, {
        cause: new Error("/Users/me/.codex/auth.json fake-secret-token"),
      }),
    );

    expect(error).toMatchObject({ code, retryable: true });
    expect(error.message).not.toContain("auth.json");
    expect(mapCodexError(error).message).not.toContain("fake-secret-token");
  });
});

describe("combined analysis Provider error mapping", () => {
  it("preserves Codex Provider errors", () => {
    const error = new CodexProviderError("RATE_LIMITED", "Codex fixed message.", true, {
      cause: new Error("private Codex cause"),
    });

    expect(mapAnalysisProviderError(error)).toEqual({
      code: "RATE_LIMITED",
      message: "Codex fixed message.",
      retryable: true,
    });
  });

  it.each([
    [new OpenAICredentialError("MODEL_PROVIDER_NOT_CONFIGURED"), "MODEL_PROVIDER_NOT_CONFIGURED"],
    [new OpenAICredentialError("MODEL_PROVIDER_AUTH_FAILED"), "MODEL_PROVIDER_AUTH_FAILED"],
    [openAIHttpError(429), "RATE_LIMITED"],
    [openAIProviderError("INVALID_RESPONSE", new Error("private SSE body")), "INVALID_RESPONSE"],
  ] as const)("maps OpenAI private error %# exactly once", (error, code) => {
    const mapped = mapAnalysisProviderError(error);

    expect(mapped).toMatchObject({ code });
    expect(mapped.message).not.toContain("private");
    expect(mapped).not.toHaveProperty("cause");
  });

  it("fails unknown configuration errors closed without exposing file contents", () => {
    const mapped = mapAnalysisProviderError(
      new Error("Provider configuration contains fake-provider-file-secret"),
    );

    expect(mapped).toEqual({
      code: "INTERNAL_ERROR",
      message: "本机模型服务处理失败，请重试。",
      retryable: true,
    });
  });

  it.each([
    [
      new CompatibleHttpConfigurationError("MODEL_PROVIDER_NOT_CONFIGURED"),
      "MODEL_PROVIDER_NOT_CONFIGURED",
      "第三方兼容模型服务尚未配置，请先完成本机配置。",
    ],
    [
      new CompatibleHttpCredentialError("MODEL_PROVIDER_NOT_CONFIGURED"),
      "MODEL_PROVIDER_NOT_CONFIGURED",
      "第三方兼容模型服务尚未配置，请先完成本机配置。",
    ],
    [
      new CompatibleHttpCredentialError("MODEL_PROVIDER_AUTH_FAILED"),
      "MODEL_PROVIDER_AUTH_FAILED",
      "第三方兼容模型服务授权无效，请更新专用 API Key。",
    ],
    [
      compatibleHttpProviderError("MODEL_PROVIDER_AUTH_FAILED"),
      "MODEL_PROVIDER_AUTH_FAILED",
      "第三方兼容模型服务授权无效，请更新专用 API Key。",
    ],
    [compatibleHttpProviderError("RATE_LIMITED"), "RATE_LIMITED", "请求过于频繁，请稍后重试。"],
    [
      compatibleHttpProviderError("NETWORK_ERROR"),
      "NETWORK_ERROR",
      "网络连接失败，请检查网络后重试。",
    ],
    [compatibleHttpProviderError("TIMEOUT"), "TIMEOUT", "模型响应超时，请重试。"],
    [compatibleHttpProviderError("CANCELLED"), "CANCELLED", "请求已取消。"],
    [
      compatibleHttpProviderError("INVALID_RESPONSE"),
      "INVALID_RESPONSE",
      "模型返回了无效结果，请重试。",
    ],
    [
      compatibleHttpProviderError("INTERNAL_ERROR"),
      "INTERNAL_ERROR",
      "本机模型服务处理失败，请重试。",
    ],
  ] as const)("maps compatible private error %# safely", (error, code, message) => {
    const mapped = mapAnalysisProviderError(error);

    expect(mapped).toMatchObject({ code, message });
    expect(mapped).not.toHaveProperty("cause");
    expect(JSON.stringify(mapped)).not.toContain("compatible-http.json");
  });
});
