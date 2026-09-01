import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readHostedImportantBatchCaptureSecrets } from "./acceptance-hosted-important-batch-secret-prompt.mjs";

test("capture secret reader fetches the fixed CA before requesting a password", async () => {
  const events = [];
  let passwordReads = 0;
  await assert.rejects(
    readHostedImportantBatchCaptureSecrets({
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: "must-not-be-used",
      },
      fetchCaCertificate: async () => {
        events.push("fetch-ca");
        throw new Error("fictional download detail");
      },
      readPassword: async () => {
        passwordReads += 1;
        return "must-not-run";
      },
    }),
    /fictional download detail/u,
  );
  assert.deepEqual(events, ["fetch-ca"]);
  assert.equal(passwordReads, 0);
});

test("capture secret reader uses only the fetched CA and Keychain password in secret-last order", async () => {
  const caCertificate = "-----BEGIN CERTIFICATE-----\nfictional\n-----END CERTIFICATE-----\n";
  const events = [];
  const secrets = await readHostedImportantBatchCaptureSecrets({
    environment: {},
    fetchCaCertificate: async () => {
      events.push("fetch-ca");
      return caCertificate;
    },
    readPassword: async () => {
      events.push("read-password");
      return "keychain-only-password";
    },
  });

  assert.deepEqual(events, ["fetch-ca", "read-password"]);
  assert.deepEqual(secrets, {
    administratorPassword: "keychain-only-password",
    caCertificate,
  });
});

test("capture secret reader rejects legacy environment before CA or Keychain work", async () => {
  const events = [];
  await assert.rejects(
    readHostedImportantBatchCaptureSecrets({
      environment: { VERCEL_TOKEN: "must-not-be-used" },
      fetchCaCertificate: async () => events.push("fetch-ca"),
      readPassword: async () => events.push("read-password"),
    }),
    /Hosted plaintext credential environment is forbidden\./u,
  );
  assert.deepEqual(events, []);
});

test(
  "real macOS TTY prompt remains available for temporary recovery-project passwords",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "huayi-hosted-secret-prompt-"));
    const helperPath = join(root, "prompt-helper.mjs");
    const marker = "FICTIONAL-TTY-SECRET-MARKER-123456789";
    const moduleUrl = new URL(
      "./acceptance-hosted-important-batch-secret-prompt.mjs",
      import.meta.url,
    );
    await writeFile(
      helperPath,
      `import { readHiddenTerminalLine } from ${JSON.stringify(moduleUrl.href)};
const password = await readHiddenTerminalLine(
  "Recovery project administrator database password: ",
);
process.stdout.write("password-length=" + password.length + "\\n");
`,
      "utf8",
    );
    try {
      const expectSource = `set timeout 10
log_user 1
spawn {${process.execPath}} {${helperPath}}
expect "Recovery project administrator database password: "
send -- "${marker}\\r"
expect eof
catch wait result
exit [lindex $result 3]
`;
      const result = await new Promise((resolveResult) => {
        const child = spawn("/usr/bin/expect", ["-f", "-"], {
          env: { LANG: "C", LC_ALL: "C" },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        let stderr = "";
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("close", (code, signal) => resolveResult({ code, signal, stderr, stdout }));
        child.stdin.end(expectSource);
      });
      assert.equal(result.code, 0, JSON.stringify(result));
      assert.equal(result.signal, null);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.includes(`password-length=${marker.length}`));
      assert.equal(result.stdout.includes(marker), false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

test(
  "real macOS TTY prompt restores echo and supports repeated Ctrl-C cancellation",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "huayi-hosted-secret-cancel-"));
    const helperPath = join(root, "prompt-cancel-helper.mjs");
    const moduleUrl = new URL(
      "./acceptance-hosted-important-batch-secret-prompt.mjs",
      import.meta.url,
    );
    await writeFile(
      helperPath,
      `import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readHiddenTerminalLine } from ${JSON.stringify(moduleUrl.href)};
const initialSignalHandlers = process.listenerCount("SIGINT");
for (let index = 1; index <= 2; index += 1) {
  try {
    await readHiddenTerminalLine("Recovery project administrator database password: ");
    process.stdout.write("unexpected-success-" + index + "\\n");
  } catch {
    const descriptor = openSync("/dev/tty", "r+");
    const status = spawnSync("/bin/stty", ["-a"], {
      env: { LANG: "C", LC_ALL: "C" },
      shell: false,
      stdio: [descriptor, "pipe", "ignore"],
      windowsHide: true,
    });
    closeSync(descriptor);
    const flags = status.stdout.toString("utf8").split(/\\s+/u);
    process.stdout.write(
      "cancelled-" + index + ";echo=" + String(flags.includes("echo")) +
        ";icanon=" + String(flags.includes("icanon")) +
        ";isig=" + String(flags.includes("isig")) +
        ";handlers=" + String(process.listenerCount("SIGINT") - initialSignalHandlers) + "\\n",
    );
  }
}
`,
      "utf8",
    );
    try {
      const expectSource = `set timeout 10
log_user 1
spawn {${process.execPath}} {${helperPath}}
expect "Recovery project administrator database password: "
send -- "\\003"
expect "cancelled-1;echo=true;icanon=true;isig=true;handlers=0"
expect "Recovery project administrator database password: "
send -- "\\003"
expect "cancelled-2;echo=true;icanon=true;isig=true;handlers=0"
expect eof
catch wait result
exit [lindex $result 3]
`;
      const result = await new Promise((resolveResult) => {
        const child = spawn("/usr/bin/expect", ["-f", "-"], {
          env: { LANG: "C", LC_ALL: "C" },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        let stderr = "";
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("close", (code, signal) => resolveResult({ code, signal, stderr, stdout }));
        child.stdin.end(expectSource);
      });
      assert.equal(result.code, 0, JSON.stringify(result));
      assert.equal(result.signal, null);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /cancelled-1;echo=true;icanon=true;isig=true;handlers=0/u);
      assert.match(result.stdout, /cancelled-2;echo=true;icanon=true;isig=true;handlers=0/u);
      assert.doesNotMatch(result.stdout, /unexpected-success/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);
