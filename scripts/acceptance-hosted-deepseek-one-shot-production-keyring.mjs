import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { createHostedAcceptanceHmacKeyring } from "./acceptance-hosted-deepseek-one-shot-hmac.mjs";
import { hostedCredentialService, runSecurityCommand } from "./acceptance-hosted-credentials.mjs";

export const hostedDeepSeekAcceptanceKeyringAccount = "deepseek-one-shot-hmac-keyring";
export const hostedDeepSeekAcceptanceKeyringContract =
  "huayi-hosted-deepseek-one-shot-hmac-keyring/v1";

const failureMessage = "Hosted Cloud Web DeepSeek production keyring failed closed.";
const keyringLabel = "语见 Hosted DeepSeek one-shot recovery keyring";
const keyMaterialPattern = /^[A-Za-z0-9_-]{43}$/u;
const maximumDocumentBytes = 8_192;
const maximumRetainedVersions = 32;

function fail() {
  throw new Error(failureMessage);
}

function safeEnvironment(environment) {
  const allowedNames = ["HOME", "LOGNAME", "PATH", "TMPDIR", "USER"];
  return {
    ...Object.fromEntries(
      allowedNames.flatMap((name) =>
        typeof environment?.[name] === "string" ? [[name, environment[name]]] : [],
      ),
    ),
    LANG: "C",
    LC_ALL: "C",
  };
}

function exactKeys(value, expected) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  return (
    actual.length === normalizedExpected.length &&
    actual.every((key, index) => key === normalizedExpected[index])
  );
}

function decodeMaterial(value) {
  if (typeof value !== "string" || !keyMaterialPattern.test(value)) fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) fail();
  return decoded;
}

function parseDocument(value) {
  try {
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value) === 0 ||
      Buffer.byteLength(value) > maximumDocumentBytes ||
      /[\0\r\n]/u.test(value)
    ) {
      fail();
    }
    const document = JSON.parse(value);
    if (
      !exactKeys(document, ["activeVersion", "contract", "keys"]) ||
      document.contract !== hostedDeepSeekAcceptanceKeyringContract ||
      !Number.isSafeInteger(document.activeVersion) ||
      document.activeVersion <= 0 ||
      !Array.isArray(document.keys) ||
      document.keys.length === 0 ||
      document.keys.length > maximumRetainedVersions
    ) {
      fail();
    }
    const keys = new Map();
    let previousVersion = 0;
    for (const entry of document.keys) {
      if (
        !exactKeys(entry, ["material", "version"]) ||
        !Number.isSafeInteger(entry.version) ||
        entry.version <= previousVersion
      ) {
        fail();
      }
      keys.set(entry.version, decodeMaterial(entry.material));
      previousVersion = entry.version;
    }
    if (!keys.has(document.activeVersion)) fail();
    return createHostedAcceptanceHmacKeyring({
      activeVersion: document.activeVersion,
      keys,
    });
  } catch {
    fail();
  }
}

function valueFromSecurityOutput(stdout) {
  if (typeof stdout !== "string" || !stdout.endsWith("\n") || stdout.endsWith("\r\n")) {
    fail();
  }
  return stdout.slice(0, -1);
}

function missing(result) {
  return result?.code === 44 || /could not be found/iu.test(result?.stderr ?? "");
}

function readArguments() {
  return [
    "find-generic-password",
    "-s",
    hostedCredentialService,
    "-a",
    hostedDeepSeekAcceptanceKeyringAccount,
    "-w",
  ];
}

function writeArguments() {
  return [
    "add-generic-password",
    "-s",
    hostedCredentialService,
    "-a",
    hostedDeepSeekAcceptanceKeyringAccount,
    "-l",
    keyringLabel,
    "-w",
  ];
}

function initialDocument(randomBytes_) {
  const material = randomBytes_(32);
  if (!(material instanceof Uint8Array) || material.byteLength !== 32) fail();
  return JSON.stringify({
    activeVersion: 1,
    contract: hostedDeepSeekAcceptanceKeyringContract,
    keys: [{ material: Buffer.from(material).toString("base64url"), version: 1 }],
  });
}

export function runHostedKeychainPromptCommand({
  arguments_,
  environment = process.env,
  spawnProcess = spawn,
  timeoutMilliseconds = 300_000,
  value,
} = {}) {
  return new Promise((resolveResult) => {
    if (
      !Array.isArray(arguments_) ||
      arguments_.length === 0 ||
      arguments_.at(-1) !== "-w" ||
      arguments_.some(
        (argument) =>
          typeof argument !== "string" || argument.length === 0 || /[\0\r\n]/u.test(argument),
      ) ||
      typeof value !== "string" ||
      Buffer.byteLength(value) === 0 ||
      Buffer.byteLength(value) > maximumDocumentBytes ||
      /[\0\r\n]/u.test(value) ||
      typeof spawnProcess !== "function" ||
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds <= 0
    ) {
      resolveResult({ code: null });
      return;
    }
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    let child;
    try {
      child = spawnProcess(
        "/usr/bin/script",
        ["-q", "-e", "/dev/null", "/usr/bin/security", ...arguments_],
        {
          env: safeEnvironment(environment),
          shell: false,
          stdio: ["pipe", "ignore", "ignore"],
          windowsHide: true,
        },
      );
      if (typeof child?.stdin?.end !== "function" || typeof child?.once !== "function") {
        try {
          child?.kill?.("SIGKILL");
        } catch {
          // The fixed result remains unavailable.
        }
        finish({ code: null });
        return;
      }
    } catch {
      finish({ code: null });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        finish({ code: null });
      }
    }, timeoutMilliseconds);
    child.stdin.once("error", () => undefined);
    child.once("error", () => finish({ code: null }));
    child.once("close", (code, signal) =>
      finish({ code: timedOut || signal !== null ? null : code }),
    );
    child.stdin.end(`${value}\n`);
  });
}

export async function loadHostedDeepSeekAcceptanceKeyring({
  createIfMissing = false,
  environment = process.env,
  platform = process.platform,
  randomBytes_ = randomBytes,
  runSecurity = runSecurityCommand,
  runSecurityPrompt = runHostedKeychainPromptCommand,
} = {}) {
  try {
    if (
      platform !== "darwin" ||
      typeof createIfMissing !== "boolean" ||
      typeof randomBytes_ !== "function" ||
      typeof runSecurity !== "function" ||
      typeof runSecurityPrompt !== "function"
    ) {
      fail();
    }
    const read = () =>
      runSecurity({
        arguments_: readArguments(),
        interactive: false,
      });
    const first = await read();
    if (first?.code === 0) return parseDocument(valueFromSecurityOutput(first.stdout));
    if (!createIfMissing || !missing(first)) fail();

    const document = initialDocument(randomBytes_);
    const write = await runSecurityPrompt({
      arguments_: writeArguments(),
      environment: safeEnvironment(environment),
      value: document,
    });
    const second = await read();
    if (second?.code !== 0) fail();
    const stored = valueFromSecurityOutput(second.stdout);
    if (write?.code === 0 && stored !== document) fail();
    return parseDocument(stored);
  } catch {
    fail();
  }
}
