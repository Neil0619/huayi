import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { renderMacosKeychainInput } from "./macos-keychain-prompt.mjs";

test("long Unicode and metacharacter data round trips as one hex argument", () => {
  const value = '私有"\\;$(){}[]'.repeat(100);
  const command = renderMacosKeychainInput(
    ["add-generic-password", "-s", "fictional", "-w"],
    value,
  );
  const encoded = / -X ([0-9a-f]+)\n$/u.exec(command)?.[1];
  assert.equal(Buffer.from(encoded, "hex").toString("utf8"), value);
  assert.equal(command.split("\n").length, 2);
  assert.equal(command.includes(value), false);
});

test(
  "native macOS security interactive mode accepts a Node socket without a PTY",
  {
    skip:
      process.platform !== "darwin"
        ? "macOS system security primitive; verified by native macOS CI"
        : false,
  },
  async () => {
    // Help only: no credentials or real Keychain items are read or written in CI.
    const result = await new Promise((resolve) => {
      const child = spawn("/usr/bin/security", ["-i"], {
        env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (x) => (output += x));
      child.stderr.on("data", (x) => (output += x));
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("error", () => {
        clearTimeout(timer);
        resolve({ code: null, output });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
      child.stdin.end("help add-generic-password\n");
    });
    assert.equal(result.code, 0);
    assert.match(result.output, /-X.*hexadecimal/u);
  },
);
