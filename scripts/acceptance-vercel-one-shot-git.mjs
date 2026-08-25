import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const branch = "codex/settings-configuration";
const commitPattern = /^[0-9a-f]{40}$/u;
const maximumOutputBytes = 128_000;

function fail() {
  throw new Error("Hosted Vercel one-shot Git verification failed.");
}

async function defaultRunProcess(command, arguments_, options) {
  try {
    const result = await execFileAsync(command, arguments_, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: maximumOutputBytes,
      shell: false,
    });
    return { status: 0, stderr: result.stderr, stdout: result.stdout };
  } catch {
    return { status: 1, stderr: "", stdout: "" };
  }
}

async function git(runProcess, repositoryRoot, arguments_) {
  const result = await runProcess("git", arguments_, { cwd: repositoryRoot });
  if (
    result?.status !== 0 ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string" ||
    result.stderr !== "" ||
    Buffer.byteLength(result.stdout, "utf8") > maximumOutputBytes
  ) {
    fail();
  }
  return result.stdout;
}

function oneLine(value) {
  if (!value.endsWith("\n") || value.slice(0, -1).includes("\n")) fail();
  return value.slice(0, -1);
}

function commitLine(value) {
  const commit = oneLine(value);
  if (!commitPattern.test(commit)) fail();
  return commit;
}

function parseChangedFiles(value) {
  if (value === "") return [];
  if (!value.endsWith("\n")) fail();
  const files = value.slice(0, -1).split("\n");
  if (
    files.length === 0 ||
    new Set(files).size !== files.length ||
    files.some(
      (file) =>
        file.length === 0 ||
        file.length > 300 ||
        file.startsWith("/") ||
        file.includes("..") ||
        /[\0\r]/u.test(file),
    )
  ) {
    fail();
  }
  return files.sort();
}

function parseDeploymentConfig(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail();
  }
  const policy = parsed?.git?.deploymentEnabled;
  let armed;
  if (policy === false) armed = false;
  if (
    typeof policy === "object" &&
    policy !== null &&
    !Array.isArray(policy) &&
    Object.keys(policy).sort().join(",") === "**,codex/settings-configuration" &&
    policy["**"] === false &&
    policy[branch] === true
  ) {
    armed = true;
  }
  if (armed === undefined) fail();
  parsed.git.deploymentEnabled = false;
  return {
    armed,
    identity: createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
  };
}

export async function inspectVercelOneShotGit({
  readFile = readFileFromDisk,
  repositoryRoot = process.cwd(),
  runProcess = defaultRunProcess,
} = {}) {
  try {
    const status = await git(runProcess, repositoryRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ]);
    const actualRoot = oneLine(
      await git(runProcess, repositoryRoot, ["rev-parse", "--show-toplevel"]),
    );
    const currentBranch = oneLine(
      await git(runProcess, repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    );
    const commit = commitLine(await git(runProcess, repositoryRoot, ["rev-parse", "HEAD"]));
    const upstreamCommit = commitLine(
      await git(runProcess, repositoryRoot, ["rev-parse", "@{upstream}"]),
    );
    const parent = commitLine(await git(runProcess, repositoryRoot, ["rev-parse", "HEAD^"]));
    const changedFiles = parseChangedFiles(
      await git(runProcess, repositoryRoot, [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        "HEAD",
      ]),
    );
    if (actualRoot !== repositoryRoot || currentBranch !== branch) fail();
    const [apiSource, webSource] = await Promise.all([
      readFile(join(repositoryRoot, "apps/api/vercel.json"), "utf8"),
      readFile(join(repositoryRoot, "apps/web/vercel.json"), "utf8"),
    ]);
    const api = parseDeploymentConfig(apiSource);
    const web = parseDeploymentConfig(webSource);
    return {
      apiArmed: api.armed,
      apiConfigIdentity: api.identity,
      branch: currentBranch,
      changedFiles,
      clean: status === "",
      commit,
      parent,
      upstreamCommit,
      webArmed: web.armed,
      webConfigIdentity: web.identity,
    };
  } catch {
    fail();
  }
}
