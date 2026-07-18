import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { assertWindowsSeaRuntime, createSeaConfiguration } from "./build-windows-host.mjs";

test("creates a repository-local Windows SEA package", () => {
  const rootDirectory = resolve("test-root");
  assert.deepEqual(createSeaConfiguration(rootDirectory), {
    disableExperimentalSEAWarning: true,
    main: resolve(rootDirectory, "apps/native-host/dist/windows/sea-main.cjs"),
    output: resolve(rootDirectory, "apps/native-host/dist/windows/huayi-native-host.exe"),
    useCodeCache: false,
    useSnapshot: false,
  });
});

test("requires the built-in Windows SEA builder", () => {
  assert.doesNotThrow(() => assertWindowsSeaRuntime("win32", "26.1.0"));
  assert.throws(() => assertWindowsSeaRuntime("darwin", "26.1.0"), /Windows/);
  assert.throws(() => assertWindowsSeaRuntime("win32", "24.10.0"), /Node\.js 26/);
});
