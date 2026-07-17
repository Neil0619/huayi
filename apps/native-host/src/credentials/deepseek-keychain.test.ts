import { describe, expect, it, vi } from "vitest";

import { ProcessTimeoutError, type ProcessRunner } from "../runtime/codex-process.js";
import {
  DEEPSEEK_KEYCHAIN_ACCOUNT,
  DEEPSEEK_KEYCHAIN_SERVICE,
  DeepSeekApiKeyReader,
} from "./deepseek-keychain.js";

describe("DeepSeekApiKeyReader", () => {
  it("reads the exact dedicated item on every request without exposing other credentials", async () => {
    const run = vi
      .fn<ProcessRunner["run"]>()
      .mockResolvedValueOnce({ exitCode: 0, signal: null, stderr: "", stdout: "ds-key-one\n" })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, stderr: "", stdout: "ds-key-two\n" });
    const reader = new DeepSeekApiKeyReader({
      environment: { HOME: "/Users/tester", OPENAI_API_KEY: "must-not-pass" },
      processRunner: { run },
      workingDirectory: "/tmp/huayi",
    });
    const signal = new AbortController().signal;

    await expect(reader.read(signal)).resolves.toBe("ds-key-one");
    await expect(reader.read(signal)).resolves.toBe("ds-key-two");

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      arguments: [
        "find-generic-password",
        "-s",
        DEEPSEEK_KEYCHAIN_SERVICE,
        "-a",
        DEEPSEEK_KEYCHAIN_ACCOUNT,
        "-w",
      ],
      executable: "/usr/bin/security",
      input: "",
    });
    expect(run.mock.calls[0]?.[0].env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("maps a missing item without leaking captured output", async () => {
    const reader = new DeepSeekApiKeyReader({
      environment: {},
      processRunner: {
        run: vi.fn(async () => ({
          exitCode: 44,
          signal: null,
          stderr: "secret must not escape",
          stdout: "",
        })),
      },
      workingDirectory: "/tmp/huayi",
    });

    await expect(reader.read(new AbortController().signal)).rejects.toMatchObject({
      code: "MODEL_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("rejects malformed and oversized values with fixed safe errors", async () => {
    for (const stdout of [" secret\n", "secret\r\n", "secret\0value", `${"x".repeat(4_097)}\n`]) {
      const reader = new DeepSeekApiKeyReader({
        environment: {},
        processRunner: {
          run: vi.fn(async () => ({ exitCode: 0, signal: null, stderr: "", stdout })),
        },
        workingDirectory: "/tmp/huayi",
      });

      const error = await reader.read(new AbortController().signal).catch((caught) => caught);

      expect(error).toMatchObject({ code: "MODEL_PROVIDER_AUTH_FAILED" });
      expect(String(error)).not.toContain(stdout.trim());
    }
  });

  it.each([
    [
      async () => ({
        exitCode: 1,
        signal: null,
        stderr: "locked secret-value",
        stdout: "secret-value",
      }),
      "INTERNAL_ERROR",
    ],
    [async () => Promise.reject(new ProcessTimeoutError(5_000)), "TIMEOUT"],
  ] as const)("maps locked and timed-out Keychain access safely", async (run, code) => {
    const reader = new DeepSeekApiKeyReader({
      environment: {},
      processRunner: { run },
      workingDirectory: "/tmp/huayi",
    });

    const error = await reader.read(new AbortController().signal).catch((caught) => caught);

    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("secret-value");
  });
});
