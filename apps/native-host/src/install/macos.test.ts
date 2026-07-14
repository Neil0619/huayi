import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProviderConfigurationStore } from "../config/provider-configuration-store.js";
import { APP_SERVER_DISABLED_FEATURES } from "../runtime/codex-app-server-config.js";
import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "../runtime/codex-process.js";
import { createMacosInstallationPaths } from "./paths.js";
import {
  installMacosNativeHost,
  renderLauncherScript,
  uninstallMacosNativeHost,
  type InstallMacosNativeHostOptions,
} from "./macos.js";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const REQUIRED_HELP = ["--stdio", "--strict-config", "--disable", "--config"].join("\n");
const DISABLED_FEATURES = APP_SERVER_DISABLED_FEATURES.map(
  (feature) => `${feature} stable false`,
).join("\n");
const SCHEMA_NAMES = [
  "explain-lexical.json",
  "explain-sentence.json",
  "translate-lexical.json",
  "translate-passage.json",
] as const;

interface InstallerFixture {
  codexExecutable: string;
  homeDirectory: string;
  rootDirectory: string;
  securityExecutable: string;
  sourceBundlePath: string;
  sourceSchemaDirectory: string;
}

class CapabilityRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];
  private readonly loginExitCode: number;

  constructor(loginExitCode = 0) {
    this.loginExitCode = loginExitCode;
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    const results: ProcessRunResult[] = [
      { exitCode: 0, signal: null, stderr: "", stdout: "codex-cli 0.144.1" },
      { exitCode: 0, signal: null, stderr: "", stdout: REQUIRED_HELP },
      { exitCode: 0, signal: null, stderr: "", stdout: DISABLED_FEATURES },
      {
        exitCode: this.loginExitCode,
        signal: null,
        stderr: this.loginExitCode === 0 ? "" : "not logged in",
        stdout: this.loginExitCode === 0 ? "Logged in using ChatGPT" : "",
      },
    ];
    const result = results[this.requests.length - 1];
    if (result === undefined) {
      throw new Error("Unexpected capability request.");
    }
    return result;
  }
}

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<InstallerFixture> {
  const rootDirectory = await mkdtemp(join(tmpdir(), "huayi-installer-test-"));
  temporaryDirectories.push(rootDirectory);
  const homeDirectory = join(rootDirectory, "Test User's Home");
  const sourceDirectory = join(rootDirectory, "build output");
  const sourceBundlePath = join(sourceDirectory, "main.js");
  const sourceSchemaDirectory = join(sourceDirectory, "provider", "schemas");
  const codexExecutable = join(sourceDirectory, "codex");
  const securityExecutable = join(sourceDirectory, "security");
  await mkdir(homeDirectory, { recursive: true });
  await mkdir(sourceSchemaDirectory, { recursive: true });
  await writeFile(sourceBundlePath, "// host bundle v1\n", "utf8");
  await writeFile(codexExecutable, "#!/bin/sh\nexit 0\n", "utf8");
  await writeFile(securityExecutable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(codexExecutable, 0o755);
  await chmod(securityExecutable, 0o755);
  await Promise.all(
    SCHEMA_NAMES.map((name) =>
      writeFile(join(sourceSchemaDirectory, name), `${JSON.stringify({ [name]: 1 })}\n`),
    ),
  );
  return {
    codexExecutable,
    homeDirectory,
    rootDirectory,
    securityExecutable,
    sourceBundlePath,
    sourceSchemaDirectory,
  };
}

function createOptions(
  fixture: InstallerFixture,
  processRunner: ProcessRunner,
  overrides: Partial<InstallMacosNativeHostOptions> = {},
): InstallMacosNativeHostOptions {
  return {
    codexExecutable: fixture.codexExecutable,
    dryRun: false,
    environment: {
      CODEX_HOME: join(fixture.homeDirectory, "Custom Codex Home"),
      HOME: fixture.homeDirectory,
      PATH: "/usr/bin:/bin",
    },
    extensionId: EXTENSION_ID,
    homeDirectory: fixture.homeDirectory,
    nodeExecutable: process.execPath,
    nodeVersion: "20.19.0",
    processRunner,
    securityExecutable: fixture.securityExecutable,
    sourceBundlePath: fixture.sourceBundlePath,
    sourceSchemaDirectory: fixture.sourceSchemaDirectory,
    ...overrides,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("installMacosNativeHost", () => {
  it("performs all validation in dry-run mode without writing external files", async () => {
    const fixture = await createFixture();
    const runner = new CapabilityRunner();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);

    const result = await installMacosNativeHost(createOptions(fixture, runner, { dryRun: true }));

    expect(result.dryRun).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(runner.requests.map((request) => request.arguments)).toEqual([
      ["--version"],
      ["app-server", "--help"],
      [
        "features",
        "list",
        ...APP_SERVER_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      ],
      ["login", "status"],
    ]);
    expect(await exists(paths.applicationDirectory)).toBe(false);
    expect(await exists(paths.nativeManifestPath)).toBe(false);
  });

  it("installs the bundle, schemas, executable launcher, workdir, marker, and Chrome manifest", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);

    await installMacosNativeHost(createOptions(fixture, new CapabilityRunner()));

    expect(await readFile(paths.bundlePath, "utf8")).toBe("// host bundle v1\n");
    expect(await readdir(paths.schemaDirectory)).toEqual([...SCHEMA_NAMES].sort());
    expect(await readdir(paths.workingDirectory)).toEqual([]);
    expect(await exists(paths.providerConfigurationPath)).toBe(false);
    await expect(
      new ProviderConfigurationStore(paths.providerConfigurationPath).read(),
    ).resolves.toBe("codex");
    expect((await stat(paths.launcherPath)).mode & 0o111).not.toBe(0);
    expect(await readFile(paths.ownershipMarkerPath, "utf8")).toContain("com.huayi.codex_bridge");

    const launcher = await readFile(paths.launcherPath, "utf8");
    expect(launcher).toContain("HUAYI_CODEX_PATH=");
    expect(launcher).toContain("HUAYI_WORK_DIR=");
    expect(launcher).toContain("HUAYI_SCHEMA_DIR=");
    expect(launcher).toContain("export HOME=");
    expect(launcher).toContain("export CODEX_HOME=");
    expect(launcher).toContain(
      `export PATH='${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin'`,
    );
    expect(launcher).not.toContain("$PATH");
    expect(launcher).toContain("exec ");
    expect(launcher).toContain('"$@"');
    expect(launcher).not.toContain("OPENAI_API_KEY");

    const manifest: unknown = JSON.parse(await readFile(paths.nativeManifestPath, "utf8"));
    expect(manifest).toEqual({
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      description: "Huayi Codex Native Messaging bridge",
      name: "com.huayi.codex_bridge",
      path: paths.launcherPath,
      type: "stdio",
    });
  });

  it("supports repeat and upgrade installs while replacing only owned runtime content", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);
    await installMacosNativeHost(createOptions(fixture, new CapabilityRunner()));
    const providerStore = new ProviderConfigurationStore(paths.providerConfigurationPath);
    await providerStore.write("openai-responses", false);
    await writeFile(join(paths.schemaDirectory, "obsolete.json"), "{}\n", "utf8");
    await writeFile(fixture.sourceBundlePath, "// host bundle v2\n", "utf8");

    await installMacosNativeHost(createOptions(fixture, new CapabilityRunner()));

    expect(await readFile(paths.bundlePath, "utf8")).toBe("// host bundle v2\n");
    expect(await readdir(paths.schemaDirectory)).toEqual([...SCHEMA_NAMES].sort());
    await expect(providerStore.read()).resolves.toBe("openai-responses");
  });

  it("refuses a symlinked provider directory instead of writing outside the owned root", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);
    const providerDirectory = dirname(paths.schemaDirectory);
    const outsideDirectory = join(fixture.rootDirectory, "outside-provider");
    await installMacosNativeHost(createOptions(fixture, new CapabilityRunner()));
    await rm(providerDirectory, { force: true, recursive: true });
    await mkdir(join(outsideDirectory, "schemas"), { recursive: true });
    await writeFile(join(outsideDirectory, "schemas", "keep.txt"), "keep", "utf8");
    await symlink(outsideDirectory, providerDirectory);

    await expect(
      installMacosNativeHost(createOptions(fixture, new CapabilityRunner())),
    ).rejects.toThrow(/owned|symbolic/i);
    expect(await readFile(join(outsideDirectory, "schemas", "keep.txt"), "utf8")).toBe("keep");
  });

  it("refuses to claim a pre-existing application directory without its ownership marker", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);
    await mkdir(paths.applicationDirectory, { recursive: true });
    await writeFile(join(paths.applicationDirectory, "personal-file.txt"), "keep", "utf8");

    await expect(
      installMacosNativeHost(createOptions(fixture, new CapabilityRunner())),
    ).rejects.toThrow(/ownership/i);
    expect(await readFile(join(paths.applicationDirectory, "personal-file.txt"), "utf8")).toBe(
      "keep",
    );
    expect(await exists(paths.nativeManifestPath)).toBe(false);
  });

  it("fails validation without writes for old Node or unauthenticated Codex", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);

    await expect(
      installMacosNativeHost(
        createOptions(fixture, new CapabilityRunner(), { nodeVersion: "16.20.2" }),
      ),
    ).rejects.toThrow(/Node\.js 18/i);
    await expect(
      installMacosNativeHost(createOptions(fixture, new CapabilityRunner(1))),
    ).rejects.toMatchObject({ code: "CODEX_NOT_AUTHENTICATED" });
    expect(await exists(paths.applicationDirectory)).toBe(false);
    expect(await exists(paths.nativeManifestPath)).toBe(false);
  });

  it("requires the fixed macOS Keychain command without reading credentials", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);

    await expect(
      installMacosNativeHost(
        createOptions(fixture, new CapabilityRunner(), {
          securityExecutable: join(fixture.rootDirectory, "missing-security"),
        }),
      ),
    ).rejects.toThrow(/security|accessible/i);
    expect(await exists(paths.applicationDirectory)).toBe(false);
    expect(await exists(paths.nativeManifestPath)).toBe(false);
  });
});

describe("launcher rendering", () => {
  it("quotes every executable and path as one POSIX shell argument", () => {
    const script = renderLauncherScript({
      bundlePath: "/Application Support/Huayi's/main.js",
      codexExecutable: "/Applications/Codex's/bin/codex",
      codexHome: "/Users/Test User/.codex",
      homeDirectory: "/Users/Test User",
      nodeExecutable: "/Node Versions/20/bin/node",
      schemaDirectory: "/Application Support/Huayi's/provider/schemas",
      workingDirectory: "/Application Support/Huayi's/workdir",
    });

    expect(script).toContain("'/Applications/Codex'\"'\"'s/bin/codex'");
    expect(script).toContain("'/Node Versions/20/bin/node'");
    expect(script).toContain("'/Application Support/Huayi'\"'\"'s/main.js'");
  });
});

describe("uninstallMacosNativeHost", () => {
  it("removes only the owned application directory and exact manifest, idempotently", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);
    await installMacosNativeHost(createOptions(fixture, new CapabilityRunner()));
    await new ProviderConfigurationStore(paths.providerConfigurationPath).write(
      "openai-responses",
      false,
    );

    await uninstallMacosNativeHost({ dryRun: false, homeDirectory: fixture.homeDirectory });
    await uninstallMacosNativeHost({ dryRun: false, homeDirectory: fixture.homeDirectory });

    expect(await exists(paths.applicationDirectory)).toBe(false);
    expect(await exists(paths.providerConfigurationPath)).toBe(false);
    expect(await exists(paths.nativeManifestPath)).toBe(false);
  });

  it("fails closed when the manifest at the Chrome path is not owned by Huayi", async () => {
    const fixture = await createFixture();
    const paths = createMacosInstallationPaths(fixture.homeDirectory);
    await installMacosNativeHost(createOptions(fixture, new CapabilityRunner()));
    await writeFile(
      paths.nativeManifestPath,
      JSON.stringify({ name: "other.host", path: "/other/launcher", type: "stdio" }),
      "utf8",
    );

    await expect(
      uninstallMacosNativeHost({ dryRun: false, homeDirectory: fixture.homeDirectory }),
    ).rejects.toThrow(/owned/i);
    expect(await exists(paths.applicationDirectory)).toBe(true);
    expect(await exists(paths.nativeManifestPath)).toBe(true);
  });
});
