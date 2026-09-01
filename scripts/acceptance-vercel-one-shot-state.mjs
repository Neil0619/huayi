import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const directoryName = "hosted-vercel-one-shot";
const maximumStateBytes = 128_000;
const defaultStateIdentity = "phase-81-0014";
const stateFileNames = Object.freeze({
  [defaultStateIdentity]: "phase-81-0014-state.json",
  "phase-92-0022": "phase-92-0022-state.json",
  "phase-93-0023": "phase-93-0023-state.json",
  "phase-93-0023-fresh-csrf": "phase-93-0023-fresh-csrf-state.json",
});
const allowedStateFileNames = new Set(Object.values(stateFileNames));

function defaultPrivateModeMatches(stats, expectedMode) {
  return (stats.mode & 0o777) === expectedMode;
}

function fail() {
  throw new Error("Hosted Vercel one-shot state verification failed.");
}

async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertPrivateDirectory(path, privateModeMatches) {
  const stats = await exists(path);
  if (stats === undefined || !stats.isDirectory() || !privateModeMatches(stats, 0o700)) fail();
}

async function assertPrivateFile(path, privateModeMatches) {
  const stats = await exists(path);
  if (
    stats === undefined ||
    !stats.isFile() ||
    !privateModeMatches(stats, 0o600) ||
    !Number.isSafeInteger(stats.size) ||
    stats.size < 3 ||
    stats.size > maximumStateBytes
  ) {
    fail();
  }
}

async function assertKnownStateFiles(directory, entries, privateModeMatches) {
  if (entries.some((entry) => !allowedStateFileNames.has(entry))) fail();
  await Promise.all(
    entries.map((entry) => assertPrivateFile(join(directory, entry), privateModeMatches)),
  );
}

async function ensureDirectory(path, { expectedMode, privateModeMatches, secure }) {
  try {
    await mkdir(path, { mode: expectedMode });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stats = await exists(path);
  if (
    stats === undefined ||
    !stats.isDirectory() ||
    (secure && !privateModeMatches(stats, expectedMode))
  ) {
    fail();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function createVercelOneShotStateStore({
  directorySync = syncDirectory,
  privateModeMatches = defaultPrivateModeMatches,
  repositoryRoot = process.cwd(),
  stateIdentity = defaultStateIdentity,
} = {}) {
  const fileName = stateFileNames[stateIdentity];
  if (fileName === undefined) fail();
  const partialName = `${fileName}.partial`;
  const artifactsRoot = join(repositoryRoot, "artifacts");
  const directory = join(artifactsRoot, directoryName);
  const statePath = join(directory, fileName);
  const partialPath = join(directory, partialName);
  return {
    async read() {
      try {
        const directoryStats = await exists(directory);
        if (directoryStats === undefined) return undefined;
        await assertPrivateDirectory(directory, privateModeMatches);
        const entries = await readdir(directory);
        if (entries.length === 0) return undefined;
        await assertKnownStateFiles(directory, entries, privateModeMatches);
        if (!entries.includes(fileName)) return undefined;
        const source = await readFile(statePath, "utf8");
        if (Buffer.byteLength(source, "utf8") > maximumStateBytes || !source.endsWith("\n")) fail();
        const state = JSON.parse(source);
        if (`${JSON.stringify(state)}\n` !== source) fail();
        return state;
      } catch {
        fail();
      }
    },
    async write(state) {
      try {
        const source = `${JSON.stringify(state)}\n`;
        if (Buffer.byteLength(source, "utf8") > maximumStateBytes) fail();
        await ensureDirectory(artifactsRoot, {
          expectedMode: 0o755,
          privateModeMatches,
          secure: false,
        });
        await ensureDirectory(directory, {
          expectedMode: 0o700,
          privateModeMatches,
          secure: true,
        });
        const entries = await readdir(directory);
        await assertKnownStateFiles(directory, entries, privateModeMatches);
        const handle = await open(partialPath, "wx", 0o600);
        try {
          await handle.chmod(0o600);
          await handle.writeFile(source, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(partialPath, statePath);
        await directorySync(directory);
      } catch {
        await rm(partialPath, { force: true }).catch(() => undefined);
        fail();
      }
    },
  };
}
