import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { auditReleaseArtifacts, sha256 } from "./miniprogram-release-audit.mjs";
import { validateReleaseConfig } from "./miniprogram-release-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const inputPaths = [
  "apps/miniprogram",
  "packages/cloud-contracts",
  "packages/learning-domain",
  "patches",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "scripts/miniprogram-release*.mjs",
];

export async function collectReleaseInputs(repository) {
  const { stdout } = await exec(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...inputPaths],
    { cwd: repository },
  );
  const files = {};
  for (const path of [...new Set(stdout.split("\0").filter(Boolean))].sort()) {
    // Never open local environment/credential files. These are not build inputs.
    if (
      !/\.(?:[cm]?[jt]sx?|json|yaml|css|patch)$/u.test(path) ||
      /(?:^|\/)(?:\.env(?:\.|$)|dist(?:-release)?\/|node_modules\/)/u.test(path)
    )
      continue;
    try {
      files[path] = sha256(await readFile(resolve(repository, path)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files[path] = "deleted";
    }
  }
  const { stdout: dirty } = await exec(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", ...inputPaths],
    { cwd: repository },
  );
  return { sha256: sha256(JSON.stringify(files)), files, dirty: dirty.split("\n").filter(Boolean) };
}

function runCommand(args, env, repository) {
  return new Promise((done, reject) => {
    const child = spawn("pnpm", args, { cwd: repository, env, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 && signal === null ? done() : reject(new Error("Release build command failed.")),
    );
  });
}

export async function executeRelease({
  mode,
  repository = root,
  env = process.env,
  run = runCommand,
  snapshot = () => collectReleaseInputs(repository),
}) {
  assert(["build", "audit"].includes(mode), "Use build or audit.");
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repository });
  const packageJson = JSON.parse(
    await readFile(resolve(repository, "apps/miniprogram/package.json"), "utf8"),
  );
  const config = validateReleaseConfig(env, packageJson.version, stdout.trim());
  const directory = resolve(repository, "artifacts/miniprogram-release");
  const output = resolve(repository, "apps/miniprogram/dist-release");
  const reportPath = resolve(directory, "bundle-report.json");
  const receiptPath = resolve(directory, "receipt.json");
  await mkdir(directory, { recursive: true });
  const lockPath = resolve(directory, ".lock");
  const lock = await open(lockPath, "wx");
  let receipt;
  const save = () => writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  try {
    const inputs = await snapshot();
    if (mode === "audit") {
      receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.status, "passed", "A successful explicit release build is required.");
      assert.deepEqual(receipt.identity, config, "Release settings changed since build.");
      assert.equal(receipt.inputs.sha256, inputs.sha256, "Build inputs changed since build.");
      const audit = await auditReleaseArtifacts({ output, reportPath, config });
      assert.deepEqual(audit, receipt.audit, "Release artifacts changed since build.");
      return receipt;
    }
    receipt = { status: "building", startedAt: new Date().toISOString(), identity: config, inputs };
    await save();
    await rm(output, { force: true, recursive: true });
    await rm(reportPath, { force: true });
    // Child configuration is explicit; no client secrets are defined by the build.
    const buildEnv = { ...env, NODE_ENV: "production", HUAYI_MINIPROGRAM_RELEASE_BUILD: "1" };
    await run(
      ["--filter", "@huayi/learning-domain", "--filter", "@huayi/cloud-contracts", "build"],
      buildEnv,
      repository,
    );
    await run(["--filter", "@huayi/miniprogram", "build"], buildEnv, repository);
    await writeFile(
      resolve(output, "release-identity.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    const audit = await auditReleaseArtifacts({ output, reportPath, config });
    assert.equal((await snapshot()).sha256, inputs.sha256, "Build inputs changed during build.");
    const { stdout: currentHead } = await exec("git", ["rev-parse", "HEAD"], { cwd: repository });
    assert.equal(currentHead.trim(), config.candidateSha, "Candidate HEAD changed during build.");
    receipt = { ...receipt, status: "passed", finishedAt: new Date().toISOString(), audit };
    await save();
    return receipt;
  } catch (error) {
    if (mode === "build" && receipt) {
      receipt = {
        ...receipt,
        status: "failed",
        finishedAt: new Date().toISOString(),
        failure: "Build or artifact validation failed; no upload authorized.",
      };
      await save();
    }
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await executeRelease({ mode: process.argv[2] });
    process.stdout.write(
      `Mini-program release ${process.argv[2]} passed: ${receipt.identity.version}; local receipt: artifacts/miniprogram-release/receipt.json. No upload performed.\n`,
    );
    if (receipt.inputs.dirty.length)
      process.stdout.write(
        "Candidate includes local changes; receipt records the workspace snapshot, not a clean commit build.\n",
      );
  } catch {
    // Validation errors may contain untrusted artifact values; never print those values.
    process.stderr.write(
      "Mini-program release check failed. Check explicit release settings, candidate identity, strict domains, bundle modules and credential-free artifacts.\n",
    );
    process.exitCode = 1;
  }
}
