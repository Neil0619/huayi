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
  EUDIC_KEYCHAIN_ACCOUNT,
  EUDIC_KEYCHAIN_SERVICE,
  EUDIC_SECURITY_EXECUTABLE,
  MacosEudicAuthorizationReader,
} from "./eudic-keychain.js";

function result(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stdout: "Bearer secret-value\n",
    ...overrides,
  };
}

function createReader(run: ProcessRunner["run"]): MacosEudicAuthorizationReader {
  return new MacosEudicAuthorizationReader({
    environment: { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
    processRunner: { run },
    workingDirectory: "/tmp/huayi",
  });
}

describe("MacosEudicAuthorizationReader", () => {
  it("reads the exact Keychain item with bounded output and removes one final newline", async () => {
    const requests: ProcessRunRequest[] = [];
    const reader = createReader(async (request) => {
      requests.push(request);
      return result();
    });
    const controller = new AbortController();

    await expect(reader.read(controller.signal)).resolves.toBe("Bearer secret-value");
    expect(requests).toEqual([
      {
        arguments: [
          "find-generic-password",
          "-s",
          EUDIC_KEYCHAIN_SERVICE,
          "-a",
          EUDIC_KEYCHAIN_ACCOUNT,
          "-w",
        ],
        cwd: "/tmp/huayi",
        env: { HOME: "/Users/tester", PATH: "/usr/bin:/bin" },
        executable: EUDIC_SECURITY_EXECUTABLE,
        input: "",
        maximumOutputBytes: 8 * 1024,
        signal: controller.signal,
        timeoutMs: 5_000,
      },
    ]);
  });

  it.each([
    ["", "empty"],
    [" Bearer secret\n", "leading whitespace"],
    ["Bearer secret \n", "trailing whitespace"],
    ["Bearer\tsecret\n", "control character"],
    ["Bearer secret\r\n", "carriage return"],
    ["Bearer secret\n\n", "multiple newlines"],
    [`${"x".repeat(4_097)}\n`, "oversized value"],
  ])("rejects a malformed authorization value: %s (%s)", async (stdout) => {
    const reader = createReader(async () => result({ stdout }));

    await expect(reader.read(new AbortController().signal)).rejects.toMatchObject({
      code: "EUDIC_AUTH_FAILED",
    });
  });

  it("maps a missing item without exposing Keychain diagnostics", async () => {
    const diagnostic =
      "security: SecKeychainSearchCopyNext: The specified item could not be found.";
    const reader = createReader(async () =>
      result({ exitCode: 44, stderr: diagnostic, stdout: "" }),
    );

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code: "EUDIC_NOT_CONFIGURED" });
    expect(String(error)).not.toContain(diagnostic);
  });

  it.each([
    [new ProcessAbortedError(), "CANCELLED"],
    [new ProcessTimeoutError(5_000), "TIMEOUT"],
    [new ProcessOutputLimitError("stdout", 8 * 1024), "INTERNAL_ERROR"],
    [new Error("locked keychain secret-value"), "INTERNAL_ERROR"],
  ])("maps process failures without leaking diagnostics", async (failure, code) => {
    const run = vi.fn().mockRejectedValue(failure);
    const reader = createReader(run);

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("secret-value");
  });

  it("maps non-missing Keychain exit codes to a safe internal error", async () => {
    const reader = createReader(async () =>
      result({ exitCode: 1, stderr: "User interaction is not allowed secret-value", stdout: "" }),
    );

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(String(error)).not.toContain("secret-value");
  });
});
