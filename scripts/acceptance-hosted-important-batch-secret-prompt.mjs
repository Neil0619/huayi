import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";

function setTerminalEcho(fileDescriptor, enabled) {
  const result = spawnSync("/bin/stty", [enabled ? "echo" : "-echo"], {
    env: { LANG: "C", LC_ALL: "C" },
    shell: false,
    stdio: [fileDescriptor, "ignore", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0 || result.signal !== null) {
    throw new Error("Hosted important-batch secret prompt is unavailable.");
  }
}

function readBoundedLine(fileDescriptor) {
  const bytes = [];
  const byte = Buffer.allocUnsafe(1);
  for (let index = 0; index <= 512; index += 1) {
    if (readSync(fileDescriptor, byte, 0, 1, null) !== 1) break;
    if (byte[0] === 10 || byte[0] === 13) return Buffer.from(bytes).toString("utf8");
    bytes.push(byte[0]);
  }
  throw new Error("Hosted important-batch secret prompt is unavailable.");
}

export async function readHiddenTerminalLine() {
  const fileDescriptor = openSync("/dev/tty", "r+");
  let echoDisabled = false;
  try {
    setTerminalEcho(fileDescriptor, false);
    echoDisabled = true;
    writeSync(fileDescriptor, "Supabase administrator database password: ");
    return readBoundedLine(fileDescriptor);
  } finally {
    try {
      if (echoDisabled) setTerminalEcho(fileDescriptor, true);
    } finally {
      writeSync(fileDescriptor, "\n");
      closeSync(fileDescriptor);
    }
  }
}

export async function readHostedImportantBatchCaptureSecrets({
  environment = process.env,
  readPassword = readHiddenTerminalLine,
} = {}) {
  const caCertificate = environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE;
  if (typeof caCertificate !== "string") {
    throw new Error("Hosted important-batch CA certificate is unavailable.");
  }
  return {
    administratorPassword: await readPassword(),
    caCertificate,
  };
}
