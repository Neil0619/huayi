import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertWindowsSeaRuntime,
  createSeaConfiguration,
  removeExistingSeaOutput,
} from "./build-windows-host.mjs";

test("creates a repository-local Windows SEA package", () => {
  assert.deepEqual(createSeaConfiguration(), {
    disableExperimentalSEAWarning: true,
    main: join("apps", "native-host", "dist", "windows", "sea-main.cjs"),
    output: join("apps", "native-host", "dist", "windows", "huayi-native-host.exe"),
    useCodeCache: false,
    useSnapshot: false,
  });
});

test("requires the built-in Windows SEA builder", () => {
  assert.doesNotThrow(() => assertWindowsSeaRuntime("win32", "26.1.0"));
  assert.throws(() => assertWindowsSeaRuntime("darwin", "26.1.0"), /Windows/);
  assert.throws(() => assertWindowsSeaRuntime("win32", "24.10.0"), /Node\.js 26/);
});

test("removes a previous Windows SEA output before rebuilding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huayi-windows-sea-"));
  const output = join(directory, "host.exe");
  try {
    await writeFile(output, "previous output");

    await removeExistingSeaOutput(output);

    await assert.rejects(access(output), (error) => error?.code === "ENOENT");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
