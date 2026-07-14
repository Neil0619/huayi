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
  OPENAI_KEYCHAIN_ACCOUNT,
  OPENAI_KEYCHAIN_SERVICE,
  OPENAI_SECURITY_EXECUTABLE,
  OpenAIApiKeyReader,
} from "./openai-keychain.js";

const SENTINEL_PREFIX = "test-openai-key-prefix";
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

function createReader(run: ProcessRunner["run"]): OpenAIApiKeyReader {
  return new OpenAIApiKeyReader({
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

describe("OpenAIApiKeyReader", () => {
  it("reads the exact Keychain item with allowlisted environment and bounded execution", async () => {
    const requests: ProcessRunRequest[] = [];
    const reader = createReader(async (request) => {
      requests.push(request);
      return result();
    });
    const controller = new AbortController();

    const apiKey = await reader.read(controller.signal);

    expect(apiKey === SENTINEL_API_KEY).toBe(true);
    expect(requests).toEqual([
      {
        arguments: [
          "find-generic-password",
          "-s",
          "com.huayi.codex_bridge.openai",
          "-a",
          "api-key",
          "-w",
        ],
        cwd: "/tmp/huayi",
        env: { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
        executable: OPENAI_SECURITY_EXECUTABLE,
        input: "",
        maximumOutputBytes: 8 * 1024,
        signal: controller.signal,
        timeoutMs: 5_000,
      },
    ]);
    expect(requests[0]?.arguments).toContain(OPENAI_KEYCHAIN_SERVICE);
    expect(requests[0]?.arguments).toContain(OPENAI_KEYCHAIN_ACCOUNT);
  });

  it("always uses the fixed macOS security executable", async () => {
    const requests: ProcessRunRequest[] = [];
    const options = {
      environment: { HOME: "/Users/tester" },
      processRunner: {
        run: async (request: ProcessRunRequest) => {
          requests.push(request);
          return result();
        },
      },
      securityExecutable: "/tmp/untrusted-security",
      workingDirectory: "/tmp/huayi",
    };
    const reader = new OpenAIApiKeyReader(options);

    await reader.read(new AbortController().signal);

    expect(requests[0]?.executable).toBe(OPENAI_SECURITY_EXECUTABLE);
  });

  it("re-reads the Keychain item for every call so rotated keys take effect", async () => {
    const run = vi
      .fn<ProcessRunner["run"]>()
      .mockResolvedValueOnce(result({ stdout: "first-test-key\n" }))
      .mockResolvedValueOnce(result({ stdout: "rotated-test-key\n" }));
    const reader = createReader(run);

    await expect(reader.read(new AbortController().signal)).resolves.toBe("first-test-key");
    await expect(reader.read(new AbortController().signal)).resolves.toBe("rotated-test-key");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("accepts one through 4,096 characters without requiring a key prefix", async () => {
    const reader = createReader(async () => result({ stdout: `${"x".repeat(4_096)}\n` }));

    await expect(reader.read(new AbortController().signal)).resolves.toBe("x".repeat(4_096));
  });

  it.each([
    ["empty", ""],
    ["leading whitespace", ` ${SENTINEL_API_KEY}\n`],
    ["trailing whitespace", `${SENTINEL_API_KEY} \n`],
    ["carriage return", `${SENTINEL_API_KEY}\r\n`],
    ["embedded line feed", `${SENTINEL_API_KEY}\ninside`],
    ["NUL", `${SENTINEL_API_KEY}\0inside`],
    ["control character", `${SENTINEL_API_KEY}\u0001inside`],
    ["delete control character", `${SENTINEL_API_KEY}\u007finside`],
    ["C1 control character", "test-value\u0085inside\n"],
    ["more than one trailing newline", `${SENTINEL_API_KEY}\n\n`],
    ["4,097 characters", `${"x".repeat(4_097)}\n`],
  ])("rejects a malformed API key: %s", async (_description, stdout) => {
    const reader = createReader(async () => result({ stdout }));

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code: "MODEL_PROVIDER_AUTH_FAILED" });
    expectNoSentinel(safeErrorText(error));
  });

  it("maps a missing item to the provider-generic not-configured error", async () => {
    const diagnostic = `missing ${SENTINEL_API_KEY}`;
    const reader = createReader(async () =>
      result({ exitCode: 44, stderr: diagnostic, stdout: SENTINEL_API_KEY }),
    );

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
    expectNoSentinel(safeErrorText(error));
  });

  it("maps a locked Keychain to a safe internal error", async () => {
    const reader = createReader(async () =>
      result({
        exitCode: 1,
        stderr: `User interaction is not allowed ${SENTINEL_API_KEY}`,
        stdout: SENTINEL_API_KEY,
      }),
    );

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code: "INTERNAL_ERROR" });
    expectNoSentinel(safeErrorText(error));
  });

  it.each([
    [new ProcessAbortedError(), "CANCELLED"],
    [new ProcessTimeoutError(5_000), "TIMEOUT"],
    [new ProcessOutputLimitError("stdout", 8 * 1024), "INTERNAL_ERROR"],
    [new Error(`process failure ${SENTINEL_API_KEY}`), "INTERNAL_ERROR"],
  ])("maps process failures without exposing diagnostics", async (failure, code) => {
    const reader = createReader(vi.fn().mockRejectedValue(failure));

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code });
    expectNoSentinel(safeErrorText(error));
  });

  it("honors an already-aborted signal without spawning a process", async () => {
    const run = vi.fn<ProcessRunner["run"]>();
    const reader = createReader(run);
    const controller = new AbortController();
    controller.abort();

    await expect(reader.read(controller.signal)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(run).not.toHaveBeenCalled();
  });
});
