import { open as openFile, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CompatibleHttpConfiguration } from "./compatible-http-configuration.js";
import {
  CompatibleHttpConfigurationStore,
  type CompatibleHttpConfigurationWriteOperations,
} from "./compatible-http-configuration-store.js";

const mini = {
  allowInsecureHttp: true,
  baseUrl: "http://101.133.153.118:9090/v1",
  effort: "low",
  model: "gpt-5.4-mini",
  schemaVersion: 1,
} as const satisfies CompatibleHttpConfiguration;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("CompatibleHttpConfigurationStore write permissions", () => {
  it("orders permission correction and atomic writes before parent-directory fsync", async () => {
    const applicationDirectory = await mkdtemp(join(tmpdir(), "huayi-compatible-mode-test-"));
    temporaryDirectories.push(applicationDirectory);
    const configurationPath = join(applicationDirectory, "compatible-http.json");
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
          async chmod(exactMode) {
            events.push("chmod");
            await handle.chmod(exactMode);
          },
          async close() {
            events.push("close");
            await handle.close();
          },
          async stat() {
            events.push("stat");
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

    expect(events).toEqual([
      "open",
      "chmod",
      "stat",
      "write",
      "fsync",
      "close",
      "rename",
      "directory fsync",
    ]);
  });

  it("corrects a restrictive creation mode and verifies exact 0600 before rename", async () => {
    const events: string[] = [];
    let currentMode = 0o400;
    const operations: CompatibleHttpConfigurationWriteOperations = {
      async open() {
        events.push("open");
        return {
          async chmod(mode) {
            events.push("chmod");
            currentMode = mode;
          },
          async close() {
            events.push("close");
          },
          async stat() {
            events.push("stat");
            return { isFile: () => true, mode: 0o100000 | currentMode };
          },
          async sync() {
            events.push("fsync");
          },
          async write() {
            events.push("write");
          },
        };
      },
      async remove() {
        events.push("remove");
      },
      async rename() {
        expect(currentMode).toBe(0o600);
        events.push("rename");
      },
      async syncDirectory() {
        events.push("directory fsync");
      },
    };
    const store = new CompatibleHttpConfigurationStore(
      "/tmp/huayi-compatible-permission-test/compatible-http.json",
      operations,
      {
        currentUserId: () => 501,
        async open() {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      },
    );

    await store.write(mini, false);

    expect(events).toEqual([
      "open",
      "chmod",
      "stat",
      "write",
      "fsync",
      "close",
      "rename",
      "directory fsync",
    ]);
  });
});
