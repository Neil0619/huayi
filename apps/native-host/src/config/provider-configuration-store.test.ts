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

import { afterEach, describe, expect, it } from "vitest";

import { CompatibleHttpConfigurationStore } from "./compatible-http-configuration-store.js";
import {
  ProviderConfigurationStore,
  type ProviderConfigurationReadOperations,
  type ProviderConfigurationWriteOperations,
} from "./provider-configuration-store.js";

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
  it("keeps provider selection separate from compatible endpoint settings", async () => {
    const { applicationDirectory, configurationPath: providerPath } = await createFixture();
    const compatiblePath = join(applicationDirectory, "compatible-http.json");
    const providerStore = new ProviderConfigurationStore(providerPath);
    const compatibleStore = new CompatibleHttpConfigurationStore(compatiblePath);
    const configuration = {
      allowInsecureHttp: true,
      baseUrl: "http://101.133.153.118:9090/v1",
      effort: "low",
      model: "gpt-5.4-mini",
      schemaVersion: 1,
    } as const;

    await providerStore.write("codex", false);
    await compatibleStore.write(configuration, false);

    await expect(providerStore.read()).resolves.toBe("codex");
    await expect(compatibleStore.read(new AbortController().signal)).resolves.toEqual(
      configuration,
    );
    expect(await readFile(providerPath, "utf8")).not.toContain("baseUrl");
    expect(await readFile(compatiblePath, "utf8")).not.toContain("provider");
  });

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

  it("requires an existing provider file to be owned by the current user", async () => {
    const contents = Buffer.from(
      `${JSON.stringify({ provider: "openai-responses", schemaVersion: 1 })}\n`,
      "utf8",
    );
    const operations = {
      currentUserId: () => 501,
      async open() {
        return {
          close: () => Promise.resolve(),
          async read(buffer: Buffer, offset: number, length: number, position: number) {
            const bytesRead = Math.min(length, Math.max(0, contents.length - position));
            contents.copy(buffer, offset, position, position + bytesRead);
            return { bytesRead };
          },
          async stat() {
            return {
              isFile: () => true,
              mode: 0o100600,
              size: contents.length,
              uid: 502,
            };
          },
        };
      },
    } as unknown as ProviderConfigurationReadOperations;

    const store = new ProviderConfigurationStore("/provider.json", undefined, operations);
    await expect(store.read()).rejects.toThrow(/owned/i);
    await expect(store.write("codex", false)).rejects.toThrow(/owned/i);
  });

  it("accepts regular-file type bits but rejects any permission bits beyond 0600", async () => {
    const valid = await createFixture();
    await writeFile(
      valid.configurationPath,
      `${JSON.stringify({ provider: "codex", schemaVersion: 1 })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await expect(new ProviderConfigurationStore(valid.configurationPath).read()).resolves.toBe(
      "codex",
    );

    const invalid = await createFixture();
    await writeFile(
      invalid.configurationPath,
      `${JSON.stringify({ provider: "codex", schemaVersion: 1 })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(invalid.configurationPath, 0o640);
    const store = new ProviderConfigurationStore(invalid.configurationPath);
    await expect(store.read()).rejects.toThrow(/0600/i);
    await expect(store.write("openai-responses", false)).rejects.toThrow(/0600/i);
  });

  it("validates and preserves an invalid existing target before set and dry-run", async () => {
    const invalidConfigurations = [
      "{invalid-provider-secret\n",
      `${JSON.stringify({ provider: "codex", schemaVersion: 2 })}\n`,
      `${JSON.stringify({ extra: true, provider: "codex", schemaVersion: 1 })}\n`,
    ];
    for (const invalidContents of invalidConfigurations) {
      for (const dryRun of [false, true]) {
        const { applicationDirectory, configurationPath } = await createFixture();
        await writeFile(configurationPath, invalidContents, { encoding: "utf8", mode: 0o600 });
        const store = new ProviderConfigurationStore(configurationPath);

        await expect(store.write("openai-responses", dryRun)).rejects.toThrow();

        expect(await readFile(configurationPath, "utf8")).toBe(invalidContents);
        expect(await readdir(applicationDirectory)).toEqual(["provider.json"]);
      }
    }
  });

  it("fails closed on invalid JSON, unknown fields, directories, and symbolic links", async () => {
    const invalidJson = await createFixture();
    await writeFile(invalidJson.configurationPath, "{invalid\n", {
      encoding: "utf8",
      mode: 0o600,
    });
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
    await writeFile(unknownField.configurationPath, unknownFieldContents, {
      encoding: "utf8",
      mode: 0o600,
    });
    await expect(
      new ProviderConfigurationStore(unknownField.configurationPath).read(),
    ).rejects.toThrow();
    expect(await readFile(unknownField.configurationPath, "utf8")).toBe(unknownFieldContents);

    const directory = await createFixture();
    await mkdir(directory.configurationPath);
    await expect(
      new ProviderConfigurationStore(directory.configurationPath).read(),
    ).rejects.toThrow(/regular file/i);
    await expect(
      new ProviderConfigurationStore(directory.configurationPath).write("codex", false),
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
    await expect(
      new ProviderConfigurationStore(symbolicLink.configurationPath).write("codex", false),
    ).rejects.toThrow(/symbolic link/i);
    expect((await lstat(symbolicLink.configurationPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(targetPath, "utf8")).toBe(targetContents);
  });

  it("rejects a provider file larger than 4 KiB", async () => {
    const { configurationPath } = await createFixture();
    await writeFile(configurationPath, "x".repeat(4 * 1024 + 1), {
      encoding: "utf8",
      mode: 0o600,
    });

    await expect(new ProviderConfigurationStore(configurationPath).read()).rejects.toThrow(
      /4 KiB/i,
    );
    await expect(
      new ProviderConfigurationStore(configurationPath).write("codex", false),
    ).rejects.toThrow(/4 KiB/i);
  });

  it("reads and validates one no-follow file handle even if its path is replaced", async () => {
    const { applicationDirectory, configurationPath } = await createFixture();
    const openedPath = join(applicationDirectory, "opened-provider.json");
    const replacementPath = join(applicationDirectory, "replacement-provider.json");
    await writeFile(
      configurationPath,
      `${JSON.stringify({ provider: "openai-responses", schemaVersion: 1 })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      replacementPath,
      `${JSON.stringify({ provider: "codex", schemaVersion: 1 })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const events: string[] = [];
    const operations: ProviderConfigurationReadOperations = {
      currentUserId,
      async open(path, flags) {
        events.push("open");
        expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
        const handle = await openFile(path, flags);
        await rename(path, openedPath);
        await symlink(replacementPath, path);
        return {
          async close() {
            events.push("close");
            await handle.close();
          },
          async read(buffer, offset, length, position) {
            events.push("read");
            return handle.read(buffer, offset, length, position);
          },
          async stat() {
            events.push("fstat");
            return handle.stat();
          },
        };
      },
    };

    await expect(
      new ProviderConfigurationStore(configurationPath, undefined, operations).read(),
    ).resolves.toBe("openai-responses");

    expect(events[0]).toBe("open");
    expect(events[1]).toBe("fstat");
    expect(events).toContain("read");
    expect(events.at(-1)).toBe("close");
    expect(events.filter((event) => event === "open")).toHaveLength(1);
    expect((await lstat(configurationPath)).isSymbolicLink()).toBe(true);
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
