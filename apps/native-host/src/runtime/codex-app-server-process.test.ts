import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAppServerArguments,
  createNodeAppServerProcess,
  HUAYI_THREAD_CONFIG,
} from "./codex-app-server-config.js";
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
    const mcpServerNamesToDisable = ["confluence-wiki-mcp", "node_repl"];
    const appServerArguments = buildAppServerArguments(mcpServerNamesToDisable);
    vi.mocked(spawn).mockReturnValue(process as unknown as ReturnType<typeof spawn>);

    expect(
      createNodeAppServerProcess({
        codexExecutable: "/opt/homebrew/bin/codex",
        environment: { HOME: "/Users/tester", OPENAI_API_KEY: "secret", PATH: "/usr/bin" },
        mcpServerNamesToDisable,
        workingDirectory: "/tmp/huayi-empty",
      }),
    ).toBe(process);
    expect(appServerArguments).not.toContain("tools.view_image=false");
    expect(appServerArguments).not.toContain("mcp_servers={}");
    expect(appServerArguments).toEqual(
      expect.arrayContaining([
        "--config",
        "mcp_servers.confluence-wiki-mcp.enabled=false",
        "--config",
        "mcp_servers.node_repl.enabled=false",
      ]),
    );
    expect(spawn).toHaveBeenCalledWith("/opt/homebrew/bin/codex", [...appServerArguments], {
      cwd: "/tmp/huayi-empty",
      env: { HOME: "/Users/tester", PATH: "/usr/bin" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("rejects unsafe, duplicate, and over-limit MCP server names", () => {
    expect(() => buildAppServerArguments(["bad.name"])).toThrow(/MCP server name/u);
    expect(() => buildAppServerArguments(["same", "same"])).toThrow(/MCP server name/u);
    expect(() =>
      buildAppServerArguments(Array.from({ length: 129 }, (_, index) => `server-${index}`)),
    ).toThrow(/Too many MCP server names/u);
  });

  it("does not send the incompatible overrides in thread configuration", () => {
    expect(HUAYI_THREAD_CONFIG).not.toHaveProperty("tools.view_image");
    expect(HUAYI_THREAD_CONFIG).not.toHaveProperty("mcp_servers");
  });
});
