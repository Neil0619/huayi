import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompatibleHttpConfiguration } from "./compatible-http-configuration.js";
import {
  CompatibleHttpConfigurationStore,
  type CompatibleHttpConfigurationReadOperations,
  type CompatibleHttpConfigurationWriteOperations,
} from "./compatible-http-configuration-store.js";

const mini = {
  allowInsecureHttp: true,
  baseUrl: "http://101.133.153.118:9090/v1",
  effort: "low",
  model: "gpt-5.4-mini",
  schemaVersion: 1,
} as const satisfies CompatibleHttpConfiguration;
const SENTINEL = "compatible-configuration-secret-sentinel";
const temporaryDirectories: string[] = [];

function currentUserId(): number {
  if (typeof process.getuid !== "function") {
    throw new Error("This test requires POSIX user IDs.");
  }
  return process.getuid();
}

async function createFixture(): Promise<{
  applicationDirectory: string;
  configurationPath: string;
}> {
  const applicationDirectory = await mkdtemp(join(tmpdir(), "huayi-compatible-config-test-"));
  temporaryDirectories.push(applicationDirectory);
  return {
    applicationDirectory,
    configurationPath: join(applicationDirectory, "compatible-http.json"),
  };
}

async function writeConfiguration(path: string, value: unknown = mini): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return [String(error), error.stack ?? "", JSON.stringify(error)].join("\n");
}

function expectSafeConfigurationError(
  error: unknown,
  code: "INTERNAL_ERROR" | "MODEL_PROVIDER_NOT_CONFIGURED",
): void {
  expect(error).toMatchObject({ code, name: "CompatibleHttpConfigurationError" });
  expect(errorText(error)).not.toContain(SENTINEL);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("CompatibleHttpConfigurationStore", () => {
  it("maps only an open-time missing file to the safe provider-not-configured error", async () => {
    const { configurationPath } = await createFixture();
    const store = new CompatibleHttpConfigurationStore(configurationPath);

    const error = await store.read(new AbortController().signal).catch((caught) => caught);

    expectSafeConfigurationError(error, "MODEL_PROVIDER_NOT_CONFIGURED");
    expect(errorText(error)).not.toContain(configurationPath);

    const afterOpenStore = new CompatibleHttpConfigurationStore(configurationPath, undefined, {
      currentUserId,
      async open() {
        return {
          close: () => Promise.resolve(),
          read: async () => ({ bytesRead: 0 }),
          stat: async () => {
            throw Object.assign(new Error(SENTINEL), { code: "ENOENT" });
          },
        };
      },
    });
    const afterOpenError = await afterOpenStore
      .read(new AbortController().signal)
      .catch((caught) => caught);
    expectSafeConfigurationError(afterOpenError, "INTERNAL_ERROR");
  });

  it("writes and reads an exact private compatible configuration", async () => {
    const { configurationPath } = await createFixture();
    const store = new CompatibleHttpConfigurationStore(configurationPath);

    const result = await store.write(mini, false);

    expect(result.dryRun).toBe(false);
    expect(result.actions).toHaveLength(1);
    expect(Object.keys(result).sort()).toEqual(["actions", "dryRun"]);
    await expect(store.read(new AbortController().signal)).resolves.toEqual(mini);
    expect((await stat(configurationPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(mini);
  });

  it("validates without writing during a dry run", async () => {
    const { configurationPath } = await createFixture();
    const store = new CompatibleHttpConfigurationStore(configurationPath);

    const result = await store.write(mini, true);

    expect(result).toMatchObject({ dryRun: true });
    expect(result.actions).toHaveLength(1);
    await expect(lstat(configurationPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("maps invalid owned contents safely and never replaces or removes them", async () => {
    for (const contents of [
      `{invalid-${SENTINEL}\n`,
      `${JSON.stringify({ ...mini, provider: SENTINEL })}\n`,
    ]) {
      const { applicationDirectory, configurationPath } = await createFixture();
      await writeFile(configurationPath, contents, { encoding: "utf8", mode: 0o600 });
      const store = new CompatibleHttpConfigurationStore(configurationPath);

      for (const operation of [
        () => store.read(new AbortController().signal),
        () => store.write(mini, true),
        () => store.write(mini, false),
        () => store.remove(true),
        () => store.remove(false),
      ]) {
        const error = await operation().catch((caught) => caught);
        expectSafeConfigurationError(error, "INTERNAL_ERROR");
        expect(await readFile(configurationPath, "utf8")).toBe(contents);
        expect(await readdir(applicationDirectory)).toEqual(["compatible-http.json"]);
      }
    }
  });

  it("fails safely on a directory and symbolic link without touching either target", async () => {
    const directory = await createFixture();
    await mkdir(directory.configurationPath);
    const directoryStore = new CompatibleHttpConfigurationStore(directory.configurationPath);
    for (const operation of [
      () => directoryStore.read(new AbortController().signal),
      () => directoryStore.write(mini, false),
      () => directoryStore.remove(false),
    ]) {
      expectSafeConfigurationError(await operation().catch((caught) => caught), "INTERNAL_ERROR");
      expect((await lstat(directory.configurationPath)).isDirectory()).toBe(true);
    }

    const symbolicLink = await createFixture();
    const targetPath = join(symbolicLink.applicationDirectory, "target.json");
    const targetContents = `${JSON.stringify({ ...mini, marker: SENTINEL })}\n`;
    await writeFile(targetPath, targetContents, { encoding: "utf8", mode: 0o600 });
    await symlink(targetPath, symbolicLink.configurationPath);
    const linkStore = new CompatibleHttpConfigurationStore(symbolicLink.configurationPath);
    for (const operation of [
      () => linkStore.read(new AbortController().signal),
      () => linkStore.write(mini, false),
      () => linkStore.remove(false),
    ]) {
      expectSafeConfigurationError(await operation().catch((caught) => caught), "INTERNAL_ERROR");
      expect((await lstat(symbolicLink.configurationPath)).isSymbolicLink()).toBe(true);
      expect(await readFile(targetPath, "utf8")).toBe(targetContents);
    }
  });

  it("requires current-UID ownership and the no-follow nonblocking open flags", async () => {
    const contents = Buffer.from(`${JSON.stringify(mini)}\n`, "utf8");
    const operations: CompatibleHttpConfigurationReadOperations = {
      currentUserId: () => 501,
      async open(_path, flags) {
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
        expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
        return {
          close: () => Promise.resolve(),
          async read(buffer, offset, length, position) {
            const bytesRead = Math.min(length, Math.max(0, contents.length - position));
            contents.copy(buffer, offset, position, position + bytesRead);
            return { bytesRead };
          },
          async stat() {
            return { isFile: () => true, mode: 0o100600, size: contents.length, uid: 502 };
          },
        };
      },
    };
    const store = new CompatibleHttpConfigurationStore(
      "/compatible-http.json",
      undefined,
      operations,
    );

    for (const operation of [
      () => store.read(new AbortController().signal),
      () => store.write(mini, false),
      () => store.remove(false),
    ]) {
      expectSafeConfigurationError(await operation().catch((caught) => caught), "INTERNAL_ERROR");
    }
  });

  it.each([0o400, 0o640, 0o601, 0o700])("rejects permissions other than 0600: %o", async (mode) => {
    const { configurationPath } = await createFixture();
    await writeConfiguration(configurationPath);
    await chmod(configurationPath, mode);
    const store = new CompatibleHttpConfigurationStore(configurationPath);

    for (const operation of [
      () => store.read(new AbortController().signal),
      () => store.write(mini, false),
      () => store.remove(false),
    ]) {
      expectSafeConfigurationError(await operation().catch((caught) => caught), "INTERNAL_ERROR");
      expect((await stat(configurationPath)).mode & 0o777).toBe(mode);
    }
  });

  it("rejects a file larger than 4 KiB without changing it", async () => {
    const { configurationPath } = await createFixture();
    const contents = SENTINEL.repeat(200);
    expect(Buffer.byteLength(contents)).toBeGreaterThan(4 * 1024);
    await writeFile(configurationPath, contents, { encoding: "utf8", mode: 0o600 });
    const store = new CompatibleHttpConfigurationStore(configurationPath);

    for (const operation of [
      () => store.read(new AbortController().signal),
      () => store.write(mini, false),
      () => store.remove(false),
    ]) {
      expectSafeConfigurationError(await operation().catch((caught) => caught), "INTERNAL_ERROR");
      expect(await readFile(configurationPath, "utf8")).toBe(contents);
    }
  });

  it("honors abort before opening and during a bounded read", async () => {
    const open = vi.fn<CompatibleHttpConfigurationReadOperations["open"]>();
    const before = new AbortController();
    const beforeReason = new Error("cancelled before compatible read");
    before.abort(beforeReason);
    const beforeStore = new CompatibleHttpConfigurationStore("/never-open", undefined, {
      currentUserId,
      open,
    });
    await expect(beforeStore.read(before.signal)).rejects.toBe(beforeReason);
    expect(open).not.toHaveBeenCalled();

    const contents = Buffer.from(`${JSON.stringify(mini)}\n`, "utf8");
    const during = new AbortController();
    const duringReason = new Error("cancelled during compatible read");
    let closed = false;
    const duringStore = new CompatibleHttpConfigurationStore("/during-read", undefined, {
      currentUserId,
      async open() {
        return {
          async close() {
            closed = true;
          },
          async read(buffer, offset) {
            contents.copy(buffer, offset, 0, 1);
            during.abort(duringReason);
            return { bytesRead: 1 };
          },
          async stat() {
            return {
              isFile: () => true,
              mode: 0o100600,
              size: contents.length,
              uid: currentUserId(),
            };
          },
        };
      },
    });
    await expect(duringStore.read(during.signal)).rejects.toBe(duringReason);
    expect(closed).toBe(true);
  });

  it("orders atomic writes through file and parent-directory fsync", async () => {
    const { applicationDirectory, configurationPath } = await createFixture();
    const events: string[] = [];
    const operations: CompatibleHttpConfigurationWriteOperations = {
      async open(path, flags, mode) {
        expect(dirname(path)).toBe(applicationDirectory);
        expect(basename(path)).toMatch(/^\.compatible-http\.json\..+\.tmp$/u);
        expect(flags).toBe("wx");
        expect(mode).toBe(0o600);
        events.push("open");
        const handle = await openFile(path, flags, mode);
        return {
          async close() {
            events.push("close");
            await handle.close();
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
        await rm(path);
      },
      async rename(from, to) {
        events.push("rename");
        await rename(from, to);
      },
      async syncDirectory(path) {
        expect(path).toBe(applicationDirectory);
        events.push("directory fsync");
      },
    };

    await new CompatibleHttpConfigurationStore(configurationPath, operations).write(mini, false);

    expect(events).toEqual(["open", "write", "fsync", "close", "rename", "directory fsync"]);
  });

  it("preserves the previous file and cleans up only its temporary file on replacement failure", async () => {
    const { applicationDirectory, configurationPath } = await createFixture();
    await writeConfiguration(configurationPath);
    const previousContents = await readFile(configurationPath, "utf8");
    const removedPaths: string[] = [];
    const operations: CompatibleHttpConfigurationWriteOperations = {
      async open(path, flags, mode) {
        const handle = await openFile(path, flags, mode);
        return {
          close: () => handle.close(),
          sync: () => handle.sync(),
          write: async (contents) => handle.writeFile(contents, "utf8"),
        };
      },
      async remove(path) {
        removedPaths.push(path);
        await rm(path);
      },
      async rename() {
        throw new Error(`rename failed ${SENTINEL}`);
      },
      async syncDirectory() {
        throw new Error("directory fsync must not run");
      },
    };
    const error = await new CompatibleHttpConfigurationStore(configurationPath, operations)
      .write(mini, false)
      .catch((caught) => caught);

    expectSafeConfigurationError(error, "INTERNAL_ERROR");
    expect(await readFile(configurationPath, "utf8")).toBe(previousContents);
    expect(removedPaths).toHaveLength(1);
    expect(dirname(removedPaths[0] ?? "")).toBe(applicationDirectory);
    expect(await readdir(applicationDirectory)).toEqual(["compatible-http.json"]);
  });

  it("removes only the exact validated file and is idempotent", async () => {
    const { applicationDirectory, configurationPath } = await createFixture();
    const unrelatedPath = join(applicationDirectory, "keep.json");
    await writeConfiguration(configurationPath);
    await writeFile(unrelatedPath, SENTINEL, "utf8");
    const store = new CompatibleHttpConfigurationStore(configurationPath);

    const dryRun = await store.remove(true);
    expect(dryRun).toMatchObject({ dryRun: true });
    expect(dryRun.actions).toHaveLength(1);
    await expect(store.read(new AbortController().signal)).resolves.toEqual(mini);

    const removed = await store.remove(false);
    expect(removed).toMatchObject({ dryRun: false });
    expect(removed.actions).toHaveLength(1);
    expect(await readFile(unrelatedPath, "utf8")).toBe(SENTINEL);
    await expect(lstat(configurationPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.remove(false)).resolves.toEqual({ actions: [], dryRun: false });
    await expect(store.remove(true)).resolves.toEqual({ actions: [], dryRun: true });
  });
});
