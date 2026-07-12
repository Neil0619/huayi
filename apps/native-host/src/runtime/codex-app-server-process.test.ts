import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_SERVER_ARGUMENTS, createNodeAppServerProcess } from "./codex-app-server.js";
import type { JsonRpcProcess } from "./json-rpc-channel.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

class FakeAppServerProcess extends EventEmitter implements JsonRpcProcess {
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();

  kill(): boolean {
    return true;
  }
}

afterEach(() => vi.clearAllMocks());

describe("Codex App Server process", () => {
  it("spawns the exact locked-down stdio server with only allowed environment variables", () => {
    const process = new FakeAppServerProcess();
    vi.mocked(spawn).mockReturnValue(process as unknown as ReturnType<typeof spawn>);

    expect(
      createNodeAppServerProcess({
        codexExecutable: "/opt/homebrew/bin/codex",
        environment: { HOME: "/Users/tester", OPENAI_API_KEY: "secret", PATH: "/usr/bin" },
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).toBe(process);
    expect(spawn).toHaveBeenCalledWith("/opt/homebrew/bin/codex", [...APP_SERVER_ARGUMENTS], {
      cwd: "/tmp/huayi-empty",
      env: { HOME: "/Users/tester", PATH: "/usr/bin" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(APP_SERVER_ARGUMENTS).toEqual([
      "app-server",
      "--stdio",
      "--strict-config",
      "--disable",
      "apps",
      "--disable",
      "hooks",
      "--disable",
      "image_generation",
      "--disable",
      "in_app_browser",
      "--disable",
      "memories",
      "--disable",
      "multi_agent",
      "--disable",
      "plugins",
      "--disable",
      "remote_plugin",
      "--disable",
      "shell_tool",
      "--disable",
      "unified_exec",
      "--disable",
      "shell_snapshot",
      "--disable",
      "tool_suggest",
      "--config",
      "analytics.enabled=false",
      "--config",
      'approval_policy="never"',
      "--config",
      'sandbox_mode="read-only"',
      "--config",
      'web_search="disabled"',
      "--config",
      'model_reasoning_effort="low"',
      "--config",
      'history.persistence="none"',
      "--config",
      "hooks={}",
      "--config",
      'shell_environment_policy.inherit="none"',
      "--config",
      "tools.view_image=false",
      "--config",
      "mcp_servers={}",
      "--config",
      "notify=[]",
      "--config",
      'otel.metrics_exporter="none"',
      "--config",
      'otel.trace_exporter="none"',
      "--config",
      "otel.log_user_prompt=false",
      "--config",
      "apps._default.enabled=false",
    ]);
  });
});
