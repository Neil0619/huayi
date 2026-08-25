import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const directoryName = "hosted-vercel-one-shot";
const fileName = "phase-81-0014-state.json";
const partialName = `${fileName}.partial`;
const maximumStateBytes = 128_000;

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
} = {}) {
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
        if (entries.length !== 1 || entries[0] !== fileName) fail();
        await assertPrivateFile(statePath, privateModeMatches);
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
        await mkdir(artifactsRoot, { mode: 0o755 });
        await mkdir(directory, { mode: 0o700 });
        await assertPrivateDirectory(directory, privateModeMatches);
        const entries = await readdir(directory);
        if (entries.some((entry) => entry !== fileName)) fail();
        if (entries.includes(fileName)) await assertPrivateFile(statePath, privateModeMatches);
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
