import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import {
  readHostedAdministratorPassword,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";

const terminalReaderSource = String.raw`
const { readSync, writeSync } = require("node:fs");
const maximumBytes = Number(process.argv[1]);
if (![512, 768].includes(maximumBytes)) process.exit(2);
const bytes = [];
const byte = Buffer.allocUnsafe(1);
for (;;) {
  if (readSync(0, byte, 0, 1, null) !== 1) process.exit(2);
  if (byte[0] === 3) process.exit(130);
  if (byte[0] === 10 || byte[0] === 13) {
    writeSync(3, Buffer.from(bytes));
    process.exit(0);
  }
  if (byte[0] === 8 || byte[0] === 127) {
    if (bytes.length > 0) {
      const removed = bytes.pop();
      if ((removed & 0xc0) === 0x80) {
        while (bytes.length > 0 && (bytes.at(-1) & 0xc0) === 0x80) bytes.pop();
        if (bytes.length > 0) bytes.pop();
      }
    }
    continue;
  }
  if (byte[0] === 21) {
    bytes.length = 0;
    continue;
  }
  if (bytes.length >= maximumBytes) process.exit(2);
  bytes.push(byte[0]);
}
`;

function runTerminalSettings(fileDescriptor, arguments_, captureOutput = false) {
  const result = spawnSync("/bin/stty", arguments_, {
    env: { LANG: "C", LC_ALL: "C" },
    shell: false,
    stdio: [fileDescriptor, captureOutput ? "pipe" : "ignore", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0 || result.signal !== null) {
    throw new Error("Hosted important-batch secret prompt is unavailable.");
  }
  return captureOutput ? result.stdout.toString("utf8") : "";
}

function readTerminalState(fileDescriptor) {
  const state = runTerminalSettings(fileDescriptor, ["-g"], true).trim();
  if (!/^[a-z0-9:=]+$/iu.test(state)) {
    throw new Error("Hosted important-batch secret prompt is unavailable.");
  }
  return state;
}

function startBoundedTerminalReader(fileDescriptor, maximumBytes) {
  const child = spawn(process.execPath, ["--eval", terminalReaderSource, String(maximumBytes)], {
    env: { LANG: "C", LC_ALL: "C" },
    shell: false,
    stdio: [fileDescriptor, "ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  const secretPipe = child.stdio[3];
  const chunks = [];
  let byteLength = 0;
  let invalidResult = false;
  const result = new Promise((resolveResult, rejectResult) => {
    let settled = false;
    const reject = () => {
      if (settled) return;
      settled = true;
      rejectResult(new Error("Hosted important-batch secret prompt is unavailable."));
    };
    secretPipe.on("data", (chunk) => {
      byteLength += chunk.length;
      if (byteLength > maximumBytes) {
        invalidResult = true;
        chunks.length = 0;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (invalidResult || code !== 0 || signal !== null) {
        rejectResult(new Error("Hosted important-batch secret prompt is unavailable."));
        return;
      }
      resolveResult(Buffer.concat(chunks).toString("utf8"));
    });
  });
  return result;
}

const allowedPromptMaximumBytes = new Map([
  ["Hosted Operator email: ", 512],
  ["Hosted Operator password: ", 768],
  ["Recovery project administrator database password: ", 512],
]);

export async function readHiddenTerminalLine(prompt) {
  const maximumBytes = allowedPromptMaximumBytes.get(prompt);
  if (maximumBytes === undefined) {
    throw new Error("Hosted important-batch secret prompt is unavailable.");
  }
  const fileDescriptor = openSync("/dev/tty", "r+");
  let terminalState;
  try {
    terminalState = readTerminalState(fileDescriptor);
    runTerminalSettings(fileDescriptor, ["-echo", "-icanon", "-isig", "min", "1", "time", "0"]);
    const readerResult = startBoundedTerminalReader(fileDescriptor, maximumBytes);
    writeSync(fileDescriptor, prompt);
    return await readerResult;
  } finally {
    try {
      if (terminalState !== undefined) runTerminalSettings(fileDescriptor, [terminalState]);
    } finally {
      writeSync(fileDescriptor, "\n");
      closeSync(fileDescriptor);
    }
  }
}

export async function readHostedImportantBatchCaptureSecrets({
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
} = {}) {
  rejectLegacyHostedCredentialEnvironment(environment);
  const caCertificate = await fetchCaCertificate();
  return {
    administratorPassword: await readPassword({ environment }),
    caCertificate,
  };
}
