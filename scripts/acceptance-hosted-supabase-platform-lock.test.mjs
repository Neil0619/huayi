import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  inspectHostedSupabasePlatformImages,
  readHostedSupabasePlatformImageLock,
  runHostedSupabasePlatformLockCli,
  verifyHostedSupabasePlatformImageLock,
} from "./acceptance-hosted-supabase-platform-lock.mjs";

const expectedActiveServices = [
  "postgres",
  "logflare",
  "vector",
  "kong",
  "gotrue",
  "mailpit",
  "postgrest",
  "storage",
  "edge-runtime",
  "postgres-meta",
  "studio",
];

const fixedTestDockerTarget = {
  command: "/fixed/local/docker",
  host: "unix:///fixed/local/docker.sock",
};

test("platform lock classifies every CLI 2.115.0 start service and pins both target platforms", async () => {
  const lock = await readHostedSupabasePlatformImageLock();

  assert.deepEqual(
    lock.services.filter((service) => service.enabled).map((service) => service.service),
    expectedActiveServices,
  );
  assert.deepEqual(
    lock.services.filter((service) => !service.enabled).map((service) => service.service),
    ["realtime", "imgproxy", "supavisor"],
  );
  for (const service of lock.services.filter((entry) => entry.enabled)) {
    assert.match(service.image.tagDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(Object.keys(service.image.platforms), ["linux/amd64", "linux/arm64"]);
    for (const platform of Object.values(service.image.platforms)) {
      assert.match(platform.manifestDigest, /^sha256:[0-9a-f]{64}$/u);
    }
  }
});

test("offline lock verification binds the repository config and pinned CLI without Docker or network", async () => {
  const calls = [];
  const result = await verifyHostedSupabasePlatformImageLock({
    readText: async (path) => {
      calls.push(path);
      return readFile(path, "utf8");
    },
  });

  assert.equal(result.verified, true);
  assert.equal(result.activeImageCount, 11);
  assert.equal(
    calls.some((path) => String(path).includes("node_modules")),
    false,
  );
});

test("lock verification fails closed on CLI, config, environment, override, or service drift", async () => {
  const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const configText = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const lockText = await readFile(
    new URL("../supabase/platform-images.lock.json", import.meta.url),
    "utf8",
  );
  const readText = async (path) => {
    const value = String(path);
    if (value.endsWith("package.json")) return packageText;
    if (value.endsWith("config.toml")) return configText;
    if (value.endsWith("platform-images.lock.json")) return lockText;
    throw new Error("unexpected read");
  };

  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: { SUPABASE_REALTIME_ENABLED: "true" },
      fileExists: async () => false,
      readText,
    }),
  );
  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: { SUPABASE_ENV: "acceptance" },
      fileExists: async () => false,
      readText,
    }),
  );
  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: {},
      fileExists: async (path) => String(path).endsWith("supabase/.env.local"),
      readText,
    }),
  );
  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: {},
      fileExists: async (path) => String(path).endsWith("rest-version"),
      readText,
    }),
  );
  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: {},
      fileExists: async () => false,
      readText: async (path) => {
        const value = await readText(path);
        return String(path).endsWith("config.toml")
          ? value.replace(
              "[realtime]\nenabled = false",
              '[realtime]\nenabled = "env(REALTIME_ENABLED)"',
            )
          : value;
      },
    }),
  );
  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: {},
      fileExists: async () => false,
      readText: async (path) => {
        const value = await readText(path);
        return String(path).endsWith("config.toml")
          ? value.replace("[realtime]\nenabled = false", "[realtime]\nenabled = true")
          : value;
      },
    }),
  );
  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: {},
      fileExists: async () => false,
      readText: async (path) => {
        const value = await readText(path);
        if (!String(path).endsWith("platform-images.lock.json")) return value;
        const lock = JSON.parse(value);
        lock.services.pop();
        return JSON.stringify(lock);
      },
    }),
  );
  await assert.rejects(
    verifyHostedSupabasePlatformImageLock({
      environment: {},
      fileExists: async () => false,
      readText: async (path) => {
        const value = await readText(path);
        if (!String(path).endsWith("platform-images.lock.json")) return value;
        const lock = JSON.parse(value);
        lock.services.find((service) => service.service === "postgres").image.tagDigest =
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        return `${JSON.stringify(lock, null, 2)}\n`;
      },
    }),
  );
});

test("local image inspection uses only fixed Unix-socket inspect commands and never pulls or starts", async () => {
  const calls = [];
  const lock = await readHostedSupabasePlatformImageLock();
  const result = await inspectHostedSupabasePlatformImages({
    architecture: "arm64",
    lock,
    resolveDockerTarget: async () => fixedTestDockerTarget,
    runInspection: async (command, arguments_) => {
      calls.push({ arguments: arguments_, command });
      const reference = arguments_.at(-1);
      const service = lock.services.find(
        (entry) =>
          entry.enabled && `${entry.image.repository}@${entry.image.tagDigest}` === reference,
      );
      return {
        code: 0,
        stdout: JSON.stringify({
          Architecture: "arm64",
          Os: "linux",
          RepoDigests: [
            `${service.image.repository.replace(/^docker\.io\/(?:library\/)?/u, "")}@${service.image.tagDigest}`,
          ],
        }),
      };
    },
  });

  assert.equal(result.ready, true);
  assert.equal(calls.length, 11);
  for (const call of calls) {
    assert.equal(call.command, fixedTestDockerTarget.command);
    assert.deepEqual(call.arguments.slice(0, 5), [
      "--host",
      fixedTestDockerTarget.host,
      "image",
      "inspect",
      "--format",
    ]);
    assert.equal(
      call.arguments.some((argument) =>
        ["pull", "run", "start", "build", "manifest"].includes(argument),
      ),
      false,
    );
  }
});

test("real local inspection rejects remote Docker selectors before spawning", async () => {
  const originalDockerHost = process.env.DOCKER_HOST;
  const originalDockerContext = process.env.DOCKER_CONTEXT;
  try {
    process.env.DOCKER_HOST = "tcp://private.example.test:2376";
    process.env.DOCKER_CONTEXT = "remote-private";

    const lock = await readHostedSupabasePlatformImageLock();
    let inspectionCalls = 0;
    await assert.rejects(
      inspectHostedSupabasePlatformImages({
        lock,
        runInspection: async () => {
          inspectionCalls += 1;
          return { code: 0, stdout: "{}" };
        },
      }),
      /Docker environment selectors are forbidden/u,
    );
    assert.equal(inspectionCalls, 0);
  } finally {
    if (originalDockerHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = originalDockerHost;
    if (originalDockerContext === undefined) delete process.env.DOCKER_CONTEXT;
    else process.env.DOCKER_CONTEXT = originalDockerContext;
  }
});

test("local image inspection rejects registry aliases even when their digest matches", async () => {
  const lock = await readHostedSupabasePlatformImageLock();
  const result = await inspectHostedSupabasePlatformImages({
    architecture: "arm64",
    lock,
    resolveDockerTarget: async () => fixedTestDockerTarget,
    runInspection: async (_command, arguments_) => ({
      code: 0,
      stdout: JSON.stringify({
        Architecture: "arm64",
        Os: "linux",
        RepoDigests: [`public.ecr.aws/alias@${arguments_.at(-1).split("@").at(-1)}`],
      }),
    }),
  });

  assert.deepEqual(result, { ready: false });
});

test("CLI exposes only static verification and local inspection with fixed output", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:platform-lock:verify"],
    "node scripts/acceptance-hosted-supabase-platform-lock.mjs --verify-lock",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:backup:platform-lock:local-images"],
    "node scripts/acceptance-hosted-supabase-platform-lock.mjs --verify-local-images",
  );

  let stderr = "";
  let stdout = "";
  const code = await runHostedSupabasePlatformLockCli({
    arguments_: ["--verify-lock"],
    inspectImages: async () => {
      throw new Error("must not inspect");
    },
    verifyLock: async () => ({ activeImageCount: 11, disabledServiceCount: 3 }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "Hosted Supabase platform image lock passed: 11 active, 3 disabled.\n");

  let invalidVerifyCalls = 0;
  let invalidOutputCalls = 0;
  const invalid = await runHostedSupabasePlatformLockCli({
    arguments_: ["pull"],
    verifyLock: async () => {
      invalidVerifyCalls += 1;
      return { activeImageCount: 11, disabledServiceCount: 3 };
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: () => {
      invalidOutputCalls += 1;
    },
  });
  assert.equal(invalid, 1);
  assert.equal(invalidVerifyCalls, 0);
  assert.equal(invalidOutputCalls, 0);
  assert.match(stderr, /arguments are invalid/u);
});
