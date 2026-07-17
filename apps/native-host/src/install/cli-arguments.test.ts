import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseInstallerArguments, resolveCodexExecutable } from "./cli.js";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("parseInstallerArguments", () => {
  it("lists every supported provider when provider-set is incomplete", () => {
    expect(() => parseInstallerArguments(["provider-set"])).toThrow(
      /api, codex, compatible-http, or deepseek/u,
    );
  });

  it("parses install, uninstall, credential, and provider commands", () => {
    expect(
      parseInstallerArguments([
        "install",
        "--",
        "--extension-id",
        EXTENSION_ID,
        "--codex-path",
        "/opt/codex",
        "--dry-run",
      ]),
    ).toEqual({
      codexPath: "/opt/codex",
      dryRun: true,
      extensionId: EXTENSION_ID,
      type: "install",
    });
    expect(parseInstallerArguments(["uninstall", "--dry-run"])).toEqual({
      dryRun: true,
      type: "uninstall",
    });
    expect(parseInstallerArguments(["eudic-configure", "--", "--dry-run"])).toEqual({
      dryRun: true,
      type: "eudic-configure",
    });
    expect(parseInstallerArguments(["eudic-remove"])).toEqual({
      dryRun: false,
      type: "eudic-remove",
    });
    expect(parseInstallerArguments(["openai-configure", "--", "--dry-run"])).toEqual({
      dryRun: true,
      type: "openai-configure",
    });
    expect(parseInstallerArguments(["openai-remove"])).toEqual({
      dryRun: false,
      type: "openai-remove",
    });
    expect(parseInstallerArguments(["provider-set", "api", "--dry-run"])).toEqual({
      dryRun: true,
      provider: "openai-responses",
      type: "provider-set",
    });
    expect(parseInstallerArguments(["provider-set", "codex"])).toEqual({
      dryRun: false,
      provider: "codex",
      type: "provider-set",
    });
    expect(parseInstallerArguments(["provider-set", "compatible-http"])).toEqual({
      dryRun: false,
      provider: "openai-compatible-http",
      type: "provider-set",
    });
    expect(parseInstallerArguments(["provider-status"])).toEqual({ type: "provider-status" });
    expect(parseInstallerArguments(["--help"])).toEqual({ type: "help" });
  });

  it.each([
    [[]],
    [["install"]],
    [["install", "--extension-id"]],
    [["uninstall", "--extension-id", EXTENSION_ID]],
    [["install", "--extension-id", EXTENSION_ID, "--unknown"]],
    [["provider-set"]],
    [["provider-set", "openai-responses"]],
    [["provider-set", "--dry-run", "api"]],
    [["provider-set", "api", "--dry-run", "--dry-run"]],
    [["provider-set", "api", "--"]],
    [["provider-set", "api", "extra"]],
    [["provider-status", "--dry-run"]],
  ])("rejects invalid arguments %j", (arguments_) => {
    expect(() => parseInstallerArguments(arguments_)).toThrow(/usage|argument|extension|provider/i);
  });
});

describe("resolveCodexExecutable", () => {
  it("finds and canonicalizes an executable from PATH without a shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "huayi-cli-arguments-test-"));
    temporaryDirectories.push(directory);
    const executable = join(directory, "codex");
    await writeFile(executable, "#!/bin/sh\n", "utf8");
    await chmod(executable, 0o755);

    await expect(resolveCodexExecutable(undefined, directory)).resolves.toBe(
      await realpath(executable),
    );
  });

  it("rejects missing and relative explicit paths", async () => {
    await expect(resolveCodexExecutable(undefined, "")).rejects.toThrow(/Codex CLI/i);
    await expect(resolveCodexExecutable("bin/codex", "/usr/bin")).rejects.toThrow(/absolute/i);
  });
});
