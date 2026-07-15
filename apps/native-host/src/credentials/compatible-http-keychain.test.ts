import { describe, expect, it, vi } from "vitest";

import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "../runtime/codex-process.js";
import {
  ProcessAbortedError,
  ProcessOutputLimitError,
  ProcessTimeoutError,
} from "../runtime/codex-process.js";
import {
  COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT,
  COMPATIBLE_HTTP_KEYCHAIN_LABEL,
  COMPATIBLE_HTTP_KEYCHAIN_SERVICE,
  CompatibleHttpApiKeyReader,
} from "./compatible-http-keychain.js";

const SENTINEL_PREFIX = "test-compatible-key-prefix";
const SENTINEL_API_KEY = `${SENTINEL_PREFIX}-sentinel`;

function result(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stdout: `${SENTINEL_API_KEY}\n`,
    ...overrides,
  };
}

function createReader(run: ProcessRunner["run"]): CompatibleHttpApiKeyReader {
  return new CompatibleHttpApiKeyReader({
    environment: {
      HOME: "/Users/tester",
      PATH: "/usr/bin:/bin",
      SECRET: "environment-sentinel-must-not-leak",
    },
    processRunner: { run },
    workingDirectory: "/tmp/huayi",
  });
}

function safeErrorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return [String(error), error.stack ?? "", JSON.stringify(error)].join("\n");
}

function expectNoSentinel(value: unknown): void {
  const text = String(value);
  expect({
    containsKey: text.includes(SENTINEL_API_KEY),
    containsPrefix: text.includes(SENTINEL_PREFIX),
  }).toEqual({ containsKey: false, containsPrefix: false });
}

describe("CompatibleHttpApiKeyReader", () => {
  it("uses only the dedicated Keychain item with fixed bounded execution", async () => {
    const requests: ProcessRunRequest[] = [];
    const reader = createReader(async (request) => {
      requests.push(request);
      return result();
    });
    const controller = new AbortController();

    await expect(reader.read(controller.signal)).resolves.toBe(SENTINEL_API_KEY);

    expect(requests).toEqual([
      {
        arguments: [
          "find-generic-password",
          "-s",
          "com.huayi.codex_bridge.compatible_http",
          "-a",
          "api-key",
          "-w",
        ],
        cwd: "/tmp/huayi",
        env: { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
        executable: "/usr/bin/security",
        input: "",
        maximumOutputBytes: 8 * 1024,
        signal: controller.signal,
        timeoutMs: 5_000,
      },
    ]);
    expect(COMPATIBLE_HTTP_KEYCHAIN_SERVICE).toBe("com.huayi.codex_bridge.compatible_http");
    expect(COMPATIBLE_HTTP_KEYCHAIN_ACCOUNT).toBe("api-key");
    expect(COMPATIBLE_HTTP_KEYCHAIN_LABEL).toBe("Huayi OpenAI-Compatible HTTP API Key");
  });

  it.each([
    ["without a trailing LF", SENTINEL_API_KEY],
    ["with one trailing LF removed", `${SENTINEL_API_KEY}\n`],
    ["at the maximum length", `${"x".repeat(4_096)}\n`],
  ])("accepts a complete valid key %s", async (_description, stdout) => {
    const reader = createReader(async () => result({ stdout }));

    await expect(reader.read(new AbortController().signal)).resolves.toBe(
      stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout,
    );
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", ` ${SENTINEL_API_KEY}\n`],
    ["trailing whitespace", `${SENTINEL_API_KEY} \n`],
    ["carriage return", `${SENTINEL_API_KEY}\r\n`],
    ["embedded line feed", `${SENTINEL_API_KEY}\ninside`],
    ["more than one trailing LF", `${SENTINEL_API_KEY}\n\n`],
    ["NUL", `${SENTINEL_API_KEY}\0inside`],
    ["C0 control character", `${SENTINEL_API_KEY}\u0001inside`],
    ["delete control character", `${SENTINEL_API_KEY}\u007finside`],
    ["C1 control character", `${SENTINEL_API_KEY}\u0085inside`],
    ["more than 4,096 characters", `${"x".repeat(4_097)}\n`],
  ])("rejects a malformed key: %s", async (_description, stdout) => {
    const reader = createReader(async () => result({ stdout }));

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code: "MODEL_PROVIDER_AUTH_FAILED" });
    expectNoSentinel(safeErrorText(error));
  });

  it("maps missing exit 44 to a fixed not-configured error", async () => {
    const reader = createReader(async () =>
      result({
        exitCode: 44,
        stderr: `missing ${SENTINEL_API_KEY}`,
        stdout: SENTINEL_API_KEY,
      }),
    );

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
    expectNoSentinel(safeErrorText(error));
  });

  it.each([
    [1, null],
    [0, "SIGTERM" as const],
  ])(
    "maps a locked or signalled Keychain result to a fixed internal error",
    async (exitCode, signal) => {
      const reader = createReader(async () =>
        result({
          exitCode,
          signal,
          stderr: `locked ${SENTINEL_API_KEY}`,
          stdout: SENTINEL_API_KEY,
        }),
      );

      const error = await reader.read(new AbortController().signal).catch((caught) => caught);

      expect(error).toMatchObject({ code: "INTERNAL_ERROR" });
      expectNoSentinel(safeErrorText(error));
    },
  );

  it.each([
    [new ProcessOutputLimitError("stdout", 8 * 1024), "INTERNAL_ERROR"],
    [new ProcessTimeoutError(5_000), "TIMEOUT"],
    [new ProcessAbortedError(), "CANCELLED"],
    [new Error(`runner failure ${SENTINEL_API_KEY}`), "INTERNAL_ERROR"],
  ])("maps runner failures without exposing diagnostics", async (failure, code) => {
    const reader = createReader(vi.fn().mockRejectedValue(failure));

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code });
    expectNoSentinel(safeErrorText(error));
  });

  it("honors an already-aborted signal without starting the runner", async () => {
    const run = vi.fn<ProcessRunner["run"]>();
    const reader = createReader(run);
    const controller = new AbortController();
    controller.abort();

    await expect(reader.read(controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(run).not.toHaveBeenCalled();
  });
});
