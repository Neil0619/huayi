import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateReleaseConfig } from "./miniprogram-release-config.mjs";
import { auditReleaseArtifacts } from "./miniprogram-release-audit.mjs";
import { executeRelease } from "./miniprogram-release.mjs";
import { preFilingChecks } from "./pre-filing-checks.mjs";

const config = {
  appId: "wx0123456789abcdef",
  apiOrigin: "https://api.release-fixture.cn",
  version: "1.0.0",
  candidateSha: "a".repeat(40),
};
const env = {
  HUAYI_MINIPROGRAM_APP_ID: config.appId,
  HUAYI_MINIPROGRAM_API_ORIGIN: config.apiOrigin,
  HUAYI_MINIPROGRAM_RELEASE_VERSION: config.version,
  HUAYI_MINIPROGRAM_RELEASE_SHA: config.candidateSha,
};

test("release config requires explicit real identity, HTTPS origin, version and candidate", () => {
  assert.deepEqual(validateReleaseConfig(env, "1.0.0", config.candidateSha), config);
  for (const key of Object.keys(env)) {
    assert.throws(() => validateReleaseConfig({ ...env, [key]: "" }, "1.0.0", config.candidateSha));
  }
  for (const apiOrigin of [
    "http://api.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://api.huayi.invalid",
    "https://api.acceptance.seen-said.cn",
    "https://api.release-fixture.cn/",
    "https://user:secret@api.example.com",
    "https://api.release-fixture.cn:443",
    "https://api.release-fixture.cn/v1",
  ]) {
    assert.throws(() =>
      validateReleaseConfig(
        { ...env, HUAYI_MINIPROGRAM_API_ORIGIN: apiOrigin },
        "1.0.0",
        config.candidateSha,
      ),
    );
  }
  assert.throws(() =>
    validateReleaseConfig(
      { ...env, HUAYI_MINIPROGRAM_APP_ID: "touristappid" },
      "1.0.0",
      config.candidateSha,
    ),
  );
  assert.throws(() => validateReleaseConfig(env, "0.13.0", config.candidateSha));
  assert.throws(() => validateReleaseConfig(env, "1.0.0", "b".repeat(40)));
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "miniprogram-release-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const output = join(root, "dist-release");
  await mkdir(output);
  const write = (name, value) =>
    writeFile(join(output, name), typeof value === "string" ? value : JSON.stringify(value));
  await write("project.config.json", {
    appid: config.appId,
    compileType: "miniprogram",
    setting: { urlCheck: true },
  });
  await write("app.json", { pages: ["pages/login/index", "pages/practice/index"] });
  await write("app.js", `const origin = "${config.apiOrigin}";`);
  await write("release-identity.json", config);
  const reportPath = join(root, "bundle-report.json");
  const bundle = {
    modules: [{ name: "react@18.3.1/node_modules/react/index.js" }, { name: "./src/app.tsx" }],
  };
  await writeFile(reportPath, JSON.stringify(bundle));
  return { output, reportPath, write, bundle };
}

test("release audit records only identity, hashes, counts and explicit limitations", async (t) => {
  const f = await fixture(t);
  const result = await auditReleaseArtifacts({ ...f, config });
  assert.equal(result.status, "passed");
  assert.equal(result.modules, 2);
  assert.equal(result.files["app.js"].length, 64);
  assert.deepEqual(result.identity, config);
});

for (const [name, mutate] of [
  [
    "tourist AppID",
    (f) => f.write("project.config.json", { appid: "touristappid", setting: { urlCheck: true } }),
  ],
  [
    "disabled strict domains",
    (f) => f.write("project.config.json", { appid: config.appId, setting: { urlCheck: false } }),
  ],
  [
    "private domain bypass",
    (f) => f.write("project.private.config.json", { setting: { urlCheck: false } }),
  ],
  ["wrong compiled API", (f) => f.write("app.js", "const origin = '';")],
  ["wrong identity", (f) => f.write("release-identity.json", { ...config, version: "0.13.0" })],
  ["test file", (f) => f.write("fixture.test.js", "const fixture = true;")],
  [
    "secret assignment",
    (f) => f.write("secret.js", 'const HUAYI_WECHAT_APP_SECRET = "super-secret-value";'),
  ],
  ["private key", (f) => f.write("secret.pem", "-----BEGIN PRIVATE KEY-----\nsecret")],
  [
    "unlabelled provider key",
    (f) => f.write("vendor.js", 'const k = "sk-0123456789abcdefghijklmnopqrstuvwxyz";'),
  ],
  [
    "database connection string",
    (f) =>
      f.write("vendor.js", 'const k = "postgresql://admin:private-password@db.example.com/main";'),
  ],
  [
    "nested test module",
    async (f) => {
      f.bundle.modules.push({ modules: [{ name: "./src/test-support/fixture.ts" }] });
      await writeFile(f.reportPath, JSON.stringify(f.bundle));
    },
  ],
  [
    "React 19",
    async (f) => {
      f.bundle.modules.push({ name: "react@19.1.0/index.js" });
      await writeFile(f.reportPath, JSON.stringify(f.bundle));
    },
  ],
  [
    "missing React 18",
    async (f) => writeFile(f.reportPath, JSON.stringify({ modules: [{ name: "./src/app.tsx" }] })),
  ],
]) {
  test(`release audit rejects ${name}`, async (t) => {
    const f = await fixture(t);
    await mutate(f);
    await assert.rejects(auditReleaseArtifacts({ ...f, config }), (error) => {
      assert(!error.message.includes("super-secret-value"));
      return true;
    });
  });
}

test("pre-filing API suite includes password-binding regression", () => {
  const step = preFilingChecks("artifacts/example").find(({ id }) => id === "api-tests");
  assert(step.args.includes("apps/api/src/miniprogram-password-binding.test.ts"));
});

async function repositoryFixture(t) {
  const repository = await mkdtemp(join(tmpdir(), "miniprogram-release-run-"));
  t.after(() => rm(repository, { force: true, recursive: true }));
  const git = (args) => promisify(execFile)("git", args, { cwd: repository });
  await git(["init", "--quiet"]);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  const { stdout } = await git(["rev-parse", "HEAD"]);
  const fixtureConfig = { ...config, candidateSha: stdout.trim() };
  const buildEnv = { ...env, HUAYI_MINIPROGRAM_RELEASE_SHA: stdout.trim() };
  await mkdir(join(repository, "apps/miniprogram"), { recursive: true });
  await writeFile(
    join(repository, "apps/miniprogram/package.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  const calls = [];
  const run = async (args, env) => {
    calls.push(args);
    assert.equal(env.HUAYI_MINIPROGRAM_RELEASE_BUILD, "1");
    const output = join(repository, "apps/miniprogram/dist-release");
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, "project.config.json"),
      JSON.stringify({
        appid: fixtureConfig.appId,
        compileType: "miniprogram",
        setting: { urlCheck: true },
      }),
    );
    await writeFile(
      join(output, "app.json"),
      JSON.stringify({ pages: ["pages/login/index", "pages/practice/index"] }),
    );
    await writeFile(join(output, "app.js"), `const origin = "${fixtureConfig.apiOrigin}";`);
    await writeFile(
      join(repository, "artifacts/miniprogram-release/bundle-report.json"),
      JSON.stringify({ modules: [{ name: "react@18.3.1/node_modules/react/index.js" }] }),
    );
  };
  return { repository, env: buildEnv, run, calls };
}

test("release runner records a stable workspace snapshot and audit rechecks its bytes", async (t) => {
  const f = await repositoryFixture(t);
  const receipt = await executeRelease({ ...f, mode: "build" });
  assert.equal(receipt.status, "passed");
  assert.equal(f.calls.length, 2);
  assert(receipt.inputs.dirty.length > 0);
  assert.equal(typeof receipt.inputs.files["apps/miniprogram/package.json"], "string");
  assert.deepEqual(await executeRelease({ ...f, mode: "audit" }), receipt);
  await writeFile(
    join(f.repository, "apps/miniprogram/dist-release/app.js"),
    `const origin = "${config.apiOrigin}"; const changed = true;`,
  );
  await assert.rejects(executeRelease({ ...f, mode: "audit" }), /artifacts changed/u);
});

test("release runner uses the current pnpm entrypoint without a PATH launcher", async (t) => {
  const f = await repositoryFixture(t);
  await mkdir(join(f.repository, "artifacts/miniprogram-release"), { recursive: true });
  await f.run([], { ...f.env, HUAYI_MINIPROGRAM_RELEASE_BUILD: "1" });
  await cp(
    join(f.repository, "apps/miniprogram/dist-release"),
    join(f.repository, "fixture-output"),
    { recursive: true },
  );
  await cp(
    join(f.repository, "artifacts/miniprogram-release/bundle-report.json"),
    join(f.repository, "fixture-report.json"),
  );
  const pnpmEntry = join(f.repository, "pnpm entrypoint & fixture.cjs");
  await writeFile(
    pnpmEntry,
    `const assert = require("node:assert/strict");
const { appendFileSync, cpSync } = require("node:fs");
assert.equal(process.env.HUAYI_MINIPROGRAM_RELEASE_BUILD, "1");
assert.equal(process.env.NODE_ENV, "production");
appendFileSync("calls.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv.includes("@huayi/miniprogram")) {
  cpSync("fixture-output", "apps/miniprogram/dist-release", { recursive: true });
  cpSync("fixture-report.json", "artifacts/miniprogram-release/bundle-report.json");
}
`,
  );
  const receipt = await executeRelease({
    repository: f.repository,
    mode: "build",
    env: { ...f.env, PATH: "", npm_execpath: pnpmEntry },
  });
  assert.equal(receipt.status, "passed");
  const calls = (await readFile(join(f.repository, "calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls, [
    ["--filter", "@huayi/learning-domain", "--filter", "@huayi/cloud-contracts", "build"],
    ["--filter", "@huayi/miniprogram", "build"],
  ]);
});

for (const pnpmEntry of [undefined, ""]) {
  test(`release runner fails closed with ${String(pnpmEntry)} pnpm entrypoint`, async (t) => {
    const f = await repositoryFixture(t);
    await assert.rejects(
      executeRelease({
        repository: f.repository,
        mode: "build",
        env: { ...f.env, PATH: "", npm_execpath: pnpmEntry },
      }),
      /must be started through pnpm/u,
    );
    const receipt = JSON.parse(
      await readFile(join(f.repository, "artifacts/miniprogram-release/receipt.json"), "utf8"),
    );
    assert.equal(receipt.status, "failed");
  });
}

test("release runner rejects source changes during compilation and saves a failed receipt", async (t) => {
  const f = await repositoryFixture(t);
  let count = 0;
  await assert.rejects(
    executeRelease({
      ...f,
      mode: "build",
      snapshot: async () => ({ sha256: String(count++), files: {}, dirty: [] }),
    }),
    /inputs changed/u,
  );
  const receipt = JSON.parse(
    await readFile(join(f.repository, "artifacts/miniprogram-release/receipt.json"), "utf8"),
  );
  assert.equal(receipt.status, "failed");
  await assert.rejects(
    executeRelease({ ...f, mode: "audit" }),
    /successful explicit release build/u,
  );
});

test("release runner fails closed before building with offline configuration", async (t) => {
  const f = await repositoryFixture(t);
  await assert.rejects(
    executeRelease({
      ...f,
      mode: "build",
      env: { ...f.env, HUAYI_MINIPROGRAM_APP_ID: "touristappid" },
    }),
  );
  assert.equal(f.calls.length, 0);
});

test("release audit rejects source changes after the build", async (t) => {
  const f = await repositoryFixture(t);
  await executeRelease({ ...f, mode: "build" });
  await writeFile(
    join(f.repository, "apps/miniprogram/changed.ts"),
    "export const changed = true;",
  );
  await assert.rejects(executeRelease({ ...f, mode: "audit" }), /inputs changed/u);
});

test("release build never clears the ordinary offline artifact directory", async (t) => {
  const f = await repositoryFixture(t);
  await mkdir(join(f.repository, "apps/miniprogram/dist"));
  const ordinary = join(f.repository, "apps/miniprogram/dist/keep.txt");
  await writeFile(ordinary, "ordinary offline package");
  await executeRelease({ ...f, mode: "build" });
  assert.equal(await readFile(ordinary, "utf8"), "ordinary offline package");
});

test("Taro React adapters and React type packages are not mistaken for runtime versions", async (t) => {
  const f = await fixture(t);
  f.bundle.modules.push(
    {
      name: "../../node_modules/.pnpm/@tarojs+plugin-framework-react@4.2.1/node_modules/@tarojs/plugin-framework-react/dist/runtime.js",
    },
    {
      name: "../../node_modules/.pnpm/@tarojs+react@4.2.1_react@18.3.1/node_modules/@tarojs/react/dist/react.esm.js",
    },
    {
      name: "../../node_modules/.pnpm/@tarojs+taro@4.2.1_@types+react@18.3.24/node_modules/@tarojs/taro/index.js",
    },
  );
  await writeFile(f.reportPath, JSON.stringify(f.bundle));
  assert.equal((await auditReleaseArtifacts({ ...f, config })).status, "passed");
});
