import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createSeaProbeConfiguration } from "./probe-windows-sea-builder.mjs";

test("creates an isolated minimal Windows SEA builder probe", () => {
  const directory = join("probe-root", "isolated");
  assert.deepEqual(createSeaProbeConfiguration(directory), {
    disableExperimentalSEAWarning: true,
    main: join(directory, "probe.cjs"),
    output: join(directory, "probe.exe"),
    useCodeCache: false,
    useSnapshot: false,
  });
});
