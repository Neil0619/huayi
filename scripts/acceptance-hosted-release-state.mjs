import { hostname as readHostname } from "node:os";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  releaseIdForCandidate,
  validateHostedReleaseState,
} from "./acceptance-hosted-release-contract.mjs";

const maximumStateBytes = 32_768;
const knownEntries = new Set([".lock", "state.json", "state.json.partial"]);

function fail() {
  throw new Error("Hosted acceptance release state failed closed.");
}

async function stats(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function privateMode(actual, expected) {
  return (actual.mode & 0o777) === expected;
}

async function ensureDirectory(path, mode, secure, privateModeMatches) {
  await mkdir(path, { mode, recursive: true });
  const actual = await stats(path);
  if (
    actual === undefined ||
    !actual.isDirectory() ||
    (secure && !privateModeMatches(actual, mode))
  ) {
    fail();
  }
}

async function assertKnownEntries(directory) {
  const entries = await readdir(directory);
  if (entries.some((entry) => !knownEntries.has(entry))) fail();
}

function canonical(source) {
  if (!source.endsWith("\n") || Buffer.byteLength(source, "utf8") > maximumStateBytes) fail();
  const parsed = JSON.parse(source);
  if (`${JSON.stringify(parsed)}\n` !== source) fail();
  return parsed;
}

function defaultIsProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export function createHostedReleaseStateStore({
  candidateSha,
  hostname = readHostname(),
  isProcessRunning = defaultIsProcessRunning,
  privateModeMatches = privateMode,
  processId = process.pid,
  repositoryRoot = process.cwd(),
} = {}) {
  const releaseId = releaseIdForCandidate(candidateSha);
  const artifactsRoot = join(repositoryRoot, "artifacts");
  const releaseRoot = join(artifactsRoot, "hosted-release");
  const directory = join(releaseRoot, releaseId);
  const statePath = join(directory, "state.json");
  const partialPath = join(directory, "state.json.partial");
  const lockPath = join(directory, ".lock");
  let lockHeld = false;

  async function prepare() {
    await ensureDirectory(artifactsRoot, 0o755, false, privateModeMatches);
    await ensureDirectory(releaseRoot, 0o700, true, privateModeMatches);
    await ensureDirectory(directory, 0o700, true, privateModeMatches);
    await assertKnownEntries(directory);
  }

  async function removeStaleLock() {
    const lockStats = await stats(lockPath);
    if (
      lockStats === undefined ||
      !lockStats.isFile() ||
      !privateModeMatches(lockStats, 0o600) ||
      lockStats.size > 4_096
    ) {
      fail();
    }
    const lock = canonical(await readFile(lockPath, "utf8"));
    if (
      Object.keys(lock).sort().join("|") !== "hostname|pid|releaseId" ||
      lock.hostname !== hostname ||
      !Number.isSafeInteger(lock.pid) ||
      lock.pid <= 0 ||
      lock.releaseId !== releaseId ||
      isProcessRunning(lock.pid)
    ) {
      fail();
    }
    await rm(lockPath);
  }

  async function createLock() {
    const handle = await open(lockPath, "wx", 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify({ hostname, pid: processId, releaseId })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    lockHeld = true;
  }

  return Object.freeze({
    directory,
    lockPath,
    releaseId,
    statePath,
    async acquire({ recover = false } = {}) {
      try {
        await prepare();
        try {
          await createLock();
        } catch (error) {
          if (!recover || error?.code !== "EEXIST") throw error;
          await removeStaleLock();
          await createLock();
        }
        let released = false;
        return async () => {
          if (released || !lockHeld) fail();
          released = true;
          lockHeld = false;
          await rm(lockPath);
        };
      } catch {
        fail();
      }
    },
    async read() {
      try {
        const directoryStats = await stats(directory);
        if (directoryStats === undefined) return undefined;
        if (!directoryStats.isDirectory() || !privateModeMatches(directoryStats, 0o700)) fail();
        await assertKnownEntries(directory);
        const stateStats = await stats(statePath);
        if (stateStats === undefined) return undefined;
        if (
          !stateStats.isFile() ||
          !privateModeMatches(stateStats, 0o600) ||
          stateStats.size > maximumStateBytes
        ) {
          fail();
        }
        const state = validateHostedReleaseState(canonical(await readFile(statePath, "utf8")));
        if (state.candidateSha !== candidateSha) fail();
        return state;
      } catch {
        fail();
      }
    },
    async write(state) {
      try {
        if (!lockHeld) fail();
        const validated = validateHostedReleaseState(state);
        if (validated.candidateSha !== candidateSha) fail();
        const source = `${JSON.stringify(validated)}\n`;
        if (Buffer.byteLength(source, "utf8") > maximumStateBytes) fail();
        await prepare();
        const handle = await open(partialPath, "wx", 0o600);
        try {
          await handle.chmod(0o600);
          await handle.writeFile(source, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(partialPath, statePath);
      } catch {
        await rm(partialPath, { force: true }).catch(() => undefined);
        fail();
      }
    },
  });
}
