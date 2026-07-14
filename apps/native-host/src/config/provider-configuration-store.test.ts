import {
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

import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderConfigurationStore,
  type ProviderConfigurationWriteOperations,
} from "./provider-configuration-store.js";

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<{
  applicationDirectory: string;
  configurationPath: string;
}> {
  const applicationDirectory = await mkdtemp(join(tmpdir(), "huayi-provider-config-test-"));
  temporaryDirectories.push(applicationDirectory);
  return {
    applicationDirectory,
    configurationPath: join(applicationDirectory, "provider.json"),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("ProviderConfigurationStore", () => {
  it("defaults a missing file to Codex and persists a private provider file", async () => {
    const { configurationPath } = await createFixture();
    const store = new ProviderConfigurationStore(configurationPath);

    await expect(store.read()).resolves.toBe("codex");
    await expect(store.write("openai-responses", false)).resolves.toEqual({
      dryRun: false,
      provider: "openai-responses",
    });
    await expect(store.read()).resolves.toBe("openai-responses");
    expect((await stat(configurationPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(configurationPath, "utf8")).toBe(
      `${JSON.stringify({ provider: "openai-responses", schemaVersion: 1 }, null, 2)}\n`,
    );
  });

  it("does not write anything during a dry run", async () => {
    const { configurationPath } = await createFixture();
    const store = new ProviderConfigurationStore(configurationPath);

    await expect(store.write("openai-responses", true)).resolves.toEqual({
      dryRun: true,
      provider: "openai-responses",
    });
    await expect(lstat(configurationPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on invalid JSON, unknown fields, directories, and symbolic links", async () => {
    const invalidJson = await createFixture();
    await writeFile(invalidJson.configurationPath, "{invalid\n", "utf8");
    await expect(
      new ProviderConfigurationStore(invalidJson.configurationPath).read(),
    ).rejects.toThrow();
    expect(await readFile(invalidJson.configurationPath, "utf8")).toBe("{invalid\n");

    const unknownField = await createFixture();
    const unknownFieldContents = `${JSON.stringify({
      endpoint: "https://example.invalid",
      provider: "codex",
      schemaVersion: 1,
    })}\n`;
    await writeFile(unknownField.configurationPath, unknownFieldContents, "utf8");
    await expect(
      new ProviderConfigurationStore(unknownField.configurationPath).read(),
    ).rejects.toThrow();
    expect(await readFile(unknownField.configurationPath, "utf8")).toBe(unknownFieldContents);

    const directory = await createFixture();
    await mkdir(directory.configurationPath);
    await expect(
      new ProviderConfigurationStore(directory.configurationPath).read(),
    ).rejects.toThrow(/regular file/i);
    expect((await lstat(directory.configurationPath)).isDirectory()).toBe(true);

    const symbolicLink = await createFixture();
    const targetPath = join(symbolicLink.applicationDirectory, "target.json");
    const targetContents = `${JSON.stringify({ provider: "codex", schemaVersion: 1 })}\n`;
    await writeFile(targetPath, targetContents, "utf8");
    await symlink(targetPath, symbolicLink.configurationPath);
    await expect(
      new ProviderConfigurationStore(symbolicLink.configurationPath).read(),
    ).rejects.toThrow(/symbolic link/i);
    expect((await lstat(symbolicLink.configurationPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(targetPath, "utf8")).toBe(targetContents);
  });

  it("rejects a provider file larger than 4 KiB", async () => {
    const { configurationPath } = await createFixture();
    await writeFile(configurationPath, "x".repeat(4 * 1024 + 1), "utf8");

    await expect(new ProviderConfigurationStore(configurationPath).read()).rejects.toThrow(
      /4 KiB/i,
    );
  });

  it("orders atomic writes through file and directory fsync", async () => {
    const { configurationPath } = await createFixture();
    const events: string[] = [];
    const operations: ProviderConfigurationWriteOperations = {
      async open(path, flags, mode) {
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
        await rm(path, { force: true });
      },
      async rename(from, to) {
        events.push("rename");
        await rename(from, to);
      },
      async syncDirectory(path) {
        events.push("directory fsync");
        const handle = await openFile(path, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
    };

    await new ProviderConfigurationStore(configurationPath, operations).write("codex", false);

    expect(events).toEqual(["open", "write", "fsync", "close", "rename", "directory fsync"]);
  });

  it("keeps the previous configuration and removes only its temporary file when rename fails", async () => {
    const { applicationDirectory, configurationPath } = await createFixture();
    const previousContents = `${JSON.stringify({ provider: "codex", schemaVersion: 1 })}\n`;
    await writeFile(configurationPath, previousContents, { encoding: "utf8", mode: 0o600 });
    const removedPaths: string[] = [];
    const failure = new Error("rename failed");
    const operations: ProviderConfigurationWriteOperations = {
      async open(path, flags, mode) {
        const handle = await openFile(path, flags, mode);
        return {
          close: () => handle.close(),
          sync: () => handle.sync(),
          write: async (contents) => {
            await handle.writeFile(contents, "utf8");
          },
        };
      },
      async remove(path) {
        removedPaths.push(path);
        await rm(path, { force: true });
      },
      async rename() {
        throw failure;
      },
      async syncDirectory() {
        throw new Error("directory fsync must not run");
      },
    };
    const store = new ProviderConfigurationStore(configurationPath, operations);

    await expect(store.write("openai-responses", false)).rejects.toBe(failure);

    await expect(store.read()).resolves.toBe("codex");
    expect(await readFile(configurationPath, "utf8")).toBe(previousContents);
    expect(removedPaths).toHaveLength(1);
    expect(dirname(removedPaths[0] ?? "")).toBe(applicationDirectory);
    expect(basename(removedPaths[0] ?? "")).toMatch(/^\.provider\.json\..+\.tmp$/u);
    expect(await readdir(applicationDirectory)).toEqual(["provider.json"]);
  });

  it("honors an already aborted read", async () => {
    const { configurationPath } = await createFixture();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      new ProviderConfigurationStore(configurationPath).read(controller.signal),
    ).rejects.toThrow("cancelled");
  });
});
