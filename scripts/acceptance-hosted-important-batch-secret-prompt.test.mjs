import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readHostedImportantBatchCaptureSecrets } from "./acceptance-hosted-important-batch-secret-prompt.mjs";

test("capture secret reader rejects a missing CA before requesting a password", async () => {
  let passwordReads = 0;
  await assert.rejects(
    readHostedImportantBatchCaptureSecrets({
      environment: {},
      readPassword: async () => {
        passwordReads += 1;
        return "must-not-run";
      },
    }),
    /CA certificate is unavailable/u,
  );
  assert.equal(passwordReads, 0);
});

test("capture secret reader accepts the CA only from the fixed environment name and the password only from the terminal reader", async () => {
  const caCertificate = "-----BEGIN CERTIFICATE-----\nfictional\n-----END CERTIFICATE-----\n";
  const secrets = await readHostedImportantBatchCaptureSecrets({
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
      PGPASSWORD: "must-not-be-used",
      SUPABASE_DB_PASSWORD: "must-not-be-used",
    },
    readPassword: async () => "terminal-only-password",
  });

  assert.deepEqual(secrets, {
    administratorPassword: "terminal-only-password",
    caCertificate,
  });
});

test(
  "real macOS TTY prompt does not redraw or echo the hidden password",
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
      `import { readHostedImportantBatchCaptureSecrets } from ${JSON.stringify(moduleUrl.href)};
const secrets = await readHostedImportantBatchCaptureSecrets({
  environment: {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE:
      "-----BEGIN CERTIFICATE-----\\nfictional\\n-----END CERTIFICATE-----\\n",
  },
});
process.stdout.write("password-length=" + secrets.administratorPassword.length + "\\n");
`,
      "utf8",
    );
    try {
      const expectSource = `set timeout 10
log_user 1
spawn {${process.execPath}} {${helperPath}}
expect "Supabase administrator database password: "
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
