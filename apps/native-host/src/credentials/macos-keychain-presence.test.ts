import { describe, expect, it, vi } from "vitest";

import { MacosKeychainPresenceProbe } from "./macos-keychain-presence.js";
import type { ProcessRunRequest } from "../runtime/codex-process.js";

describe("MacosKeychainPresenceProbe", () => {
  it("checks item metadata without requesting the secret value", async () => {
    const run = vi.fn<
      (request: ProcessRunRequest) => Promise<{
        exitCode: number;
        signal: null;
        stderr: string;
        stdout: string;
      }>
    >(async () => ({ exitCode: 0, signal: null, stderr: "", stdout: "" }));
    const probe = new MacosKeychainPresenceProbe({
      account: "api-key",
      environment: {},
      processRunner: { run },
      securityExecutable: "/usr/bin/security",
      service: "com.huayi.test",
      workingDirectory: "/private/empty",
    });
    await expect(probe.read(new AbortController().signal)).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: ["find-generic-password", "-s", "com.huayi.test", "-a", "api-key"],
        executable: "/usr/bin/security",
      }),
    );
    expect(run.mock.calls[0]?.[0]?.arguments).not.toContain("-w");
  });
});
