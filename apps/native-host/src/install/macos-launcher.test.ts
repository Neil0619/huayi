import { describe, expect, it } from "vitest";

import { renderLauncherScript } from "./macos.js";

describe("launcher rendering", () => {
  it("quotes every executable and path as one POSIX shell argument", () => {
    const script = renderLauncherScript({
      bundlePath: "/Application Support/Huayi's/main.js",
      codexExecutable: "/Applications/Codex's/bin/codex",
      codexHome: "/Users/Test User/.codex",
      homeDirectory: "/Users/Test User",
      nodeExecutable: "/Node Versions/20/bin/node",
      schemaDirectory: "/Application Support/Huayi's/provider/schemas",
      workingDirectory: "/Application Support/Huayi's/workdir",
    });

    expect(script).toContain("'/Applications/Codex'\"'\"'s/bin/codex'");
    expect(script).toContain("'/Node Versions/20/bin/node'");
    expect(script).toContain("'/Application Support/Huayi'\"'\"'s/main.js'");
  });
});
