import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type MacosManifestWriteOperations,
  writeMacosNativeManifest,
} from "./macos-native-manifest.js";

const temporaryDirectories: string[] = [];

async function createManifestFixture(): Promise<{
  manifestDirectory: string;
  manifestPath: string;
  previousContents: string;
}> {
  const rootDirectory = await mkdtemp(join(tmpdir(), "huayi-manifest-test-"));
  temporaryDirectories.push(rootDirectory);
  const manifestDirectory = join(rootDirectory, "NativeMessagingHosts");
  const manifestPath = join(manifestDirectory, "com.huayi.codex_bridge.json");
  const previousContents = '{"allowed_origins":["chrome-extension://old/"]}\n';
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(manifestPath, previousContents, { encoding: "utf8", mode: 0o600 });
  return { manifestDirectory, manifestPath, previousContents };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.skipIf(process.platform === "win32")("writeMacosNativeManifest", () => {
  it("keeps the previous manifest and cleans the 0600 temporary file when rename fails", async () => {
    const { manifestDirectory, manifestPath, previousContents } = await createManifestFixture();
    const events: string[] = [];
    const openedPaths: string[] = [];
    const removedPaths: string[] = [];
    const failure = new Error("rename failed");
    const operations: MacosManifestWriteOperations = {
      async open(path, flags, mode) {
        events.push("open");
        openedPaths.push(path);
        expect(dirname(path)).toBe(manifestDirectory);
        expect(basename(path)).toMatch(/^\.com\.huayi\.codex_bridge\.json\..+\.tmp$/u);
        expect(flags).toBe("wx");
        expect(mode).toBe(0o600);
        const handle = await open(path, flags, mode);
        return {
          async chmod(fileMode) {
            events.push("chmod");
            expect(fileMode).toBe(0o600);
            await handle.chmod(fileMode);
          },
          async close() {
            events.push("close");
            await handle.close();
          },
          async stat() {
            events.push("fstat");
            return handle.stat();
          },
          async sync() {
            events.push("fsync");
            await handle.sync();
          },
          async write(contents) {
            events.push("write");
            await handle.writeFile(contents, "utf8");
          },
        };
      },
      async remove(path) {
        events.push("remove");
        removedPaths.push(path);
        await rm(path, { force: true });
      },
      async rename(from, to) {
        events.push("rename");
        expect(from).toBe(openedPaths[0]);
        expect(to).toBe(manifestPath);
        throw failure;
      },
      async syncDirectory() {
        throw new Error("directory fsync must not run after a failed rename");
      },
    };

    await expect(
      writeMacosNativeManifest(manifestPath, '{"allowed_origins":["new"]}\n', operations),
    ).rejects.toBe(failure);

    expect(events).toEqual([
      "open",
      "chmod",
      "fstat",
      "write",
      "fsync",
      "close",
      "rename",
      "remove",
    ]);
    expect(await readFile(manifestPath, "utf8")).toBe(previousContents);
    expect(removedPaths).toEqual(openedPaths);
    expect(await readdir(manifestDirectory)).toEqual([basename(manifestPath)]);
    expect((await stat(manifestPath)).mode & 0o7777).toBe(0o600);
  });

  it("writes, syncs, and renames a same-directory 0600 temporary file", async () => {
    const { manifestDirectory, manifestPath } = await createManifestFixture();
    const replacementContents = '{"allowed_origins":["chrome-extension://new/"]}\n';
    const events: string[] = [];
    let temporaryPath = "";
    const operations: MacosManifestWriteOperations = {
      async open(path, flags, mode) {
        events.push("open");
        temporaryPath = path;
        const handle = await open(path, flags, mode);
        return {
          async chmod(fileMode) {
            events.push("chmod");
            await handle.chmod(fileMode);
          },
          async close() {
            events.push("close");
            await handle.close();
          },
          async stat() {
            events.push("fstat");
            return handle.stat();
          },
          async sync() {
            events.push("fsync");
            await handle.sync();
          },
          async write(contents) {
            events.push("write");
            await handle.writeFile(contents, "utf8");
          },
        };
      },
      async remove(path) {
        events.push("remove");
        await rm(path, { force: true });
      },
      async rename(from, to) {
        events.push("rename");
        await rename(from, to);
      },
      async syncDirectory(path) {
        events.push("directory fsync");
        const handle = await open(path, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
    };

    await writeMacosNativeManifest(manifestPath, replacementContents, operations);

    expect(dirname(temporaryPath)).toBe(manifestDirectory);
    expect(basename(temporaryPath)).toMatch(/^\.com\.huayi\.codex_bridge\.json\..+\.tmp$/u);
    expect(events).toEqual([
      "open",
      "chmod",
      "fstat",
      "write",
      "fsync",
      "close",
      "rename",
      "directory fsync",
    ]);
    expect(await readFile(manifestPath, "utf8")).toBe(replacementContents);
    expect(await readdir(manifestDirectory)).toEqual([basename(manifestPath)]);
    expect((await stat(manifestPath)).mode & 0o7777).toBe(0o600);
  });
});
