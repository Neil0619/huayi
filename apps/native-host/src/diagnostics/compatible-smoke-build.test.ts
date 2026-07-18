import { describe, expect, it } from "vitest";

import { createNativeHostConfig } from "../../vite.config.js";

describe("compatible smoke build", () => {
  it("emits the dedicated diagnostic without clearing the host distribution", () => {
    const configuration = createNativeHostConfig("compatible-smoke");
    const build = configuration.build;
    const rollupOptions = typeof build === "object" ? build.rollupOptions : undefined;
    const output =
      rollupOptions !== undefined && !Array.isArray(rollupOptions)
        ? rollupOptions.output
        : undefined;
    const singleOutput = Array.isArray(output) ? output[0] : output;

    expect(build).toMatchObject({ emptyOutDir: false });
    expect(rollupOptions).toMatchObject({
      input: expect.stringMatching(/src[\\/]diagnostics[\\/]run-compatible-smoke\.ts$/),
    });
    expect(singleOutput).toMatchObject({
      entryFileNames: "diagnostics/run-compatible-smoke.js",
    });
    expect(configuration.plugins).toEqual([]);
  });
});
