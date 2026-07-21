import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAXIMUM_FRAME_BYTES = 1024 * 1024;
const REQUEST_ID = "verify-windows-sea-health";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function encodeNativeMessage(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function validateHealthFrame(frame) {
  if (frame.length < 4) throw new Error("Windows SEA returned an incomplete stdout frame.");
  const payloadLength = frame.readUInt32LE(0);
  if (payloadLength === 0 || payloadLength > MAXIMUM_FRAME_BYTES) {
    throw new Error("Windows SEA returned an invalid stdout frame length.");
  }
  if (frame.length !== payloadLength + 4) {
    throw new Error("Windows SEA returned trailing or incomplete stdout bytes.");
  }
  let event;
  try {
    event = JSON.parse(frame.subarray(4).toString("utf8"));
  } catch {
    throw new Error("Windows SEA returned invalid health JSON.");
  }
  try {
    assert.deepEqual(event, {
      codexVersion: null,
      hostVersion: "0.10.0",
      model: "deepseek-v4-flash",
      provider: "deepseek-chat-completions",
      ready: true,
      requestId: REQUEST_ID,
      schemaVersion: 5,
      type: "health-result",
    });
  } catch {
    throw new Error("Windows SEA returned an unexpected health result.");
  }
}

export async function verifyNativeHostExecutable({
  arguments: arguments_ = [],
  cwd = repositoryRoot,
  env = process.env,
  executable,
  spawnProcess = spawn,
  timeoutMs = 5_000,
}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawnProcess(executable, arguments_, {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    let stdoutLength = 0;
    let responseValidated = false;
    let settled = false;

    const timer = setTimeout(() => {
      fail(new Error("Windows SEA health verification timed out."));
    }, timeoutMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolvePromise();
      else reject(error);
    }

    function fail(error) {
      if (settled) return;
      child.kill();
      finish(error);
    }

    child.once("error", (error) => finish(error));
    child.stdin.once("error", (error) => fail(error));
    child.stderr.on("data", () => fail(new Error("Windows SEA contaminated stderr.")));
    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutLength += bytes.length;
      if (stdoutLength > MAXIMUM_FRAME_BYTES + 4) {
        fail(new Error("Windows SEA exceeded the stdout frame limit."));
        return;
      }
      stdoutChunks.push(bytes);
      const output = Buffer.concat(stdoutChunks, stdoutLength);
      if (output.length < 4) return;
      const expectedLength = output.readUInt32LE(0) + 4;
      if (expectedLength > MAXIMUM_FRAME_BYTES + 4 || output.length > expectedLength) {
        fail(new Error("Windows SEA returned trailing or oversized stdout bytes."));
        return;
      }
      if (output.length === expectedLength) {
        try {
          validateHealthFrame(output);
          responseValidated = true;
          child.stdin.end();
        } catch (error) {
          fail(error);
        }
      }
    });
    child.once("close", (code, signal) => {
      if (!responseValidated) {
        finish(new Error("Windows SEA exited without an exact health result."));
      } else if (code !== 0 || signal !== null) {
        finish(new Error("Windows SEA exited unsuccessfully after health verification."));
      } else {
        finish();
      }
    });

    child.stdin.write(
      encodeNativeMessage({ requestId: REQUEST_ID, schemaVersion: 5, type: "health" }),
    );
  });
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Windows SEA health verification requires Windows.");
  }
  const executable = resolve(repositoryRoot, "apps/native-host/dist/windows/huayi-native-host.exe");
  await verifyNativeHostExecutable({ cwd: dirname(executable), executable });
  process.stdout.write("Windows SEA health verified.\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Windows SEA verification failed."}\n`,
    );
    process.exitCode = 1;
  });
}
