import { describe, expect, it, vi } from "vitest";

import type { CompatibleHttpConfiguration } from "../config/compatible-http-configuration.js";
import {
  executeCompatibleConfigurationCommand,
  parseCompatibleConfigurationCommand,
  type CompatibleConfigurationCliRuntime,
} from "./compatible-http-configuration-cli.js";

const mini = {
  allowInsecureHttp: true,
  baseUrl: "http://101.133.153.118:9090/v1",
  effort: "low",
  model: "gpt-5.4-mini",
  schemaVersion: 1,
} as const satisfies CompatibleHttpConfiguration;

const luna = {
  allowInsecureHttp: true,
  baseUrl: "http://101.133.153.118:9090/v1",
  effort: "none",
  model: "gpt-5.6-luna",
  schemaVersion: 1,
} as const satisfies CompatibleHttpConfiguration;

function setArguments(configuration: CompatibleHttpConfiguration, dryRun = false): string[] {
  return [
    "compatible-config-set",
    "--base-url",
    configuration.baseUrl,
    "--model",
    configuration.model,
    "--effort",
    configuration.effort,
    "--allow-insecure-http",
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

describe("parseCompatibleConfigurationCommand", () => {
  it("parses both fixed model/effort pairs and lifecycle commands", () => {
    expect(parseCompatibleConfigurationCommand(setArguments(mini, true))).toEqual({
      configuration: mini,
      dryRun: true,
      type: "compatible-config-set",
    });
    expect(parseCompatibleConfigurationCommand(setArguments(luna))).toEqual({
      configuration: luna,
      dryRun: false,
      type: "compatible-config-set",
    });
    expect(parseCompatibleConfigurationCommand(["compatible-config-status"])).toEqual({
      type: "compatible-config-status",
    });
    expect(parseCompatibleConfigurationCommand(["compatible-config-remove", "--dry-run"])).toEqual({
      dryRun: true,
      type: "compatible-config-remove",
    });
    expect(parseCompatibleConfigurationCommand(["provider-status"])).toBeUndefined();
  });

  it.each([
    ["compatible-config-set"],
    [...setArguments(mini), "--base-url", mini.baseUrl],
    [...setArguments(mini), "--model", mini.model],
    [...setArguments(mini), "--effort", mini.effort],
    setArguments(mini).filter((argument) => argument !== "--allow-insecure-http"),
    setArguments({ ...mini, effort: "none" } as never),
    ["compatible-config-set", ...setArguments(mini).slice(1), "--api-key", "secret"],
    ["compatible-config-set", "--", ...setArguments(mini).slice(1)],
    ["compatible-config-status", "--dry-run"],
    ["compatible-config-remove", "--dry-run", "--dry-run"],
    ["compatible-config-remove", "--"],
  ])("rejects invalid or ambiguous arguments %j", (...arguments_: string[]) => {
    expect(() => parseCompatibleConfigurationCommand(arguments_)).toThrow();
  });
});

function runtime(configuration: CompatibleHttpConfiguration = mini) {
  const output: string[] = [];
  const read = vi.fn(async () => configuration);
  const remove = vi.fn(async (dryRun: boolean) => ({
    actions: ["Remove compatible configuration"],
    dryRun,
  }));
  const write = vi.fn(async (_value: CompatibleHttpConfiguration, dryRun: boolean) => ({
    actions: ["Write compatible configuration"],
    dryRun,
  }));
  return {
    output,
    read,
    remove,
    runtime: {
      compatibleHttpConfigurationStore: { read, remove, write },
      writeOutput: (message: string) => output.push(message),
    } satisfies CompatibleConfigurationCliRuntime,
    write,
  };
}

describe("executeCompatibleConfigurationCommand", () => {
  it("writes configuration without changing provider selection", async () => {
    const fixture = runtime();
    await executeCompatibleConfigurationCommand(
      { configuration: mini, dryRun: false, type: "compatible-config-set" },
      fixture.runtime,
    );

    expect(fixture.write).toHaveBeenCalledWith(mini, false);
    expect(fixture.output).toEqual(["Write compatible configuration"]);
  });

  it("prints only configuration fields and the fixed plaintext warning", async () => {
    const fixture = runtime();
    await executeCompatibleConfigurationCommand(
      { type: "compatible-config-status" },
      fixture.runtime,
    );

    expect(fixture.output).toEqual([
      `Base URL: ${mini.baseUrl}`,
      `Model: ${mini.model}`,
      `Effort: ${mini.effort}`,
      "WARNING: API credentials and selected text use plaintext HTTP.",
    ]);
    expect(fixture.output.join("\n")).not.toMatch(/keychain|api key|secret/i);
  });

  it("removes only compatible configuration with dry-run reporting", async () => {
    const fixture = runtime();
    await executeCompatibleConfigurationCommand(
      { dryRun: true, type: "compatible-config-remove" },
      fixture.runtime,
    );

    expect(fixture.remove).toHaveBeenCalledWith(true);
    expect(fixture.output).toEqual(["[dry-run] Remove compatible configuration"]);
  });
});
