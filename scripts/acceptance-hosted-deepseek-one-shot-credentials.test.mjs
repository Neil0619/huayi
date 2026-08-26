import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import test from "node:test";

import { readHostedDeepSeekOperatorCredentials } from "./acceptance-hosted-deepseek-one-shot-credentials.mjs";

const failurePattern = /^Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;
const email = "operator@example.test";
const password = "fictional-password-123";
const interactiveInput = Object.freeze({ isTTY: true });
const interactiveOutput = Object.freeze({ isTTY: true });
const controlCharacters = Object.freeze([
  ...Array.from({ length: 0x20 }, (_, codePoint) => String.fromCodePoint(codePoint)),
  ...Array.from({ length: 0x21 }, (_, offset) => String.fromCodePoint(0x7f + offset)),
]);

async function captureFailure(options) {
  try {
    await readHostedDeepSeekOperatorCredentials(options);
  } catch (error) {
    return error;
  }
  assert.fail("expected credential input to fail closed");
}

test("reads normalized credentials from two hidden TTY prompts without serializing them", async () => {
  const prompts = [];
  const writes = [];
  const values = [`  OPERATOR@EXAMPLE.TEST  `, password];
  const credentials = await readHostedDeepSeekOperatorCredentials({
    input: interactiveInput,
    output: {
      isTTY: true,
      write: (value) => writes.push(value),
    },
    readHiddenLine: async (prompt) => {
      prompts.push(prompt);
      return values.shift();
    },
  });

  assert.deepEqual(prompts, ["Hosted Operator email: ", "Hosted Operator password: "]);
  assert.deepEqual(writes, []);
  assert.equal(credentials.email, email);
  assert.equal(credentials.password, password);
  assert.deepEqual(Object.keys(credentials), []);
  assert.equal(JSON.stringify(credentials), "{}");
  assert.equal(JSON.stringify({ credentials }).includes(email), false);
  assert.equal(JSON.stringify({ credentials }).includes(password), false);
  assert.equal(inspect(credentials).includes(email), false);
  assert.equal(inspect(credentials).includes(password), false);
  assert.equal(Object.isFrozen(credentials), true);
});

test("has no argv, environment, file, or persisted-state credential source", async () => {
  const source = await readFile(
    new URL("./acceptance-hosted-deepseek-one-shot-credentials.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /process\.(?:argv|env)|node:fs|writeFile|stateStore/iu);
});

test("mirrors the accepted 320-character email and 12-to-256 password bounds", async () => {
  const maximumEmail = `${"a".repeat(308)}@example.com`;
  assert.equal(maximumEmail.length, 320);
  for (const boundedPassword of ["p".repeat(12), "p".repeat(256)]) {
    const values = [maximumEmail, boundedPassword];
    const credentials = await readHostedDeepSeekOperatorCredentials({
      input: interactiveInput,
      output: interactiveOutput,
      readHiddenLine: async () => values.shift(),
    });
    assert.equal(credentials.email, maximumEmail);
    assert.equal(credentials.password, boundedPassword);
  }
});

test(
  "real macOS TTY accepts a valid 256-character Unicode password without echo",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "huayi-hosted-operator-credentials-"));
    const helperPath = join(root, "credential-helper.mjs");
    const unicodePassword = "密".repeat(256);
    const moduleUrl = new URL(
      "./acceptance-hosted-deepseek-one-shot-credentials.mjs",
      import.meta.url,
    );
    await writeFile(
      helperPath,
      `import { readHostedDeepSeekOperatorCredentials } from ${JSON.stringify(moduleUrl.href)};
const credentials = await readHostedDeepSeekOperatorCredentials();
process.stdout.write("password-length=" + credentials.password.length + "\\n");
`,
      "utf8",
    );
    try {
      const expectSource = `set timeout 10
log_user 1
spawn {${process.execPath}} {${helperPath}}
expect "Hosted Operator email: "
send -- "${email}\\r"
expect "Hosted Operator password: "
send -- "${unicodePassword}\\r"
expect "password-length=256"
expect eof
catch wait result
exit [lindex $result 3]
`;
      const result = await new Promise((resolveResult) => {
        const child = spawn("/usr/bin/expect", ["-f", "-"], {
          env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
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
      assert.equal(result.stdout.includes(email), false);
      assert.equal(result.stdout.includes(unicodePassword), false);
      assert.ok(result.stdout.includes("password-length=256"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

test("rejects non-interactive input or output before requesting either credential", async () => {
  for (const [input, output] of [
    [{ isTTY: false }, interactiveOutput],
    [interactiveInput, { isTTY: false }],
    [null, interactiveOutput],
    [interactiveInput, null],
  ]) {
    let reads = 0;
    const error = await captureFailure({
      input,
      output,
      readHiddenLine: async () => {
        reads += 1;
        return "must-not-run";
      },
    });
    assert.match(error.message, failurePattern);
    assert.equal(reads, 0);
  }
});

test("rejects invalid email and every control character without reading or echoing a password", async () => {
  for (const invalidEmail of [
    "",
    "not-an-email",
    ...controlCharacters.map((character) => `${email}${character}private`),
    `${"a".repeat(310)}@example.test`,
  ]) {
    const reads = [];
    const error = await captureFailure({
      input: interactiveInput,
      output: interactiveOutput,
      readHiddenLine: async (prompt) => {
        reads.push(prompt);
        return invalidEmail;
      },
    });
    assert.match(error.message, failurePattern);
    if (invalidEmail.length > 0) assert.equal(error.message.includes(invalidEmail), false);
    assert.deepEqual(reads, ["Hosted Operator email: "]);
  }
});

test("rejects invalid hidden passwords and reflects no credential or prompt failure", async () => {
  for (const invalidPassword of [
    "",
    "too-short",
    ...controlCharacters.map((character) => `${password}${character}private`),
    "p".repeat(257),
  ]) {
    const error = await captureFailure({
      input: interactiveInput,
      output: interactiveOutput,
      readHiddenLine: async (prompt) =>
        prompt === "Hosted Operator email: " ? email : invalidPassword,
    });
    assert.match(error.message, failurePattern);
    assert.equal(error.message.includes(email), false);
    if (invalidPassword.length > 0) assert.equal(error.message.includes(invalidPassword), false);
  }

  const privatePromptDetail = `${email}:${password}`;
  const error = await captureFailure({
    input: interactiveInput,
    output: interactiveOutput,
    readHiddenLine: async () => {
      throw new Error(privatePromptDetail);
    },
  });
  assert.match(error.message, failurePattern);
  assert.equal(error.message.includes(privatePromptDetail), false);
});
