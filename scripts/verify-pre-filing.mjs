import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { preFilingChecks } from "./pre-filing-checks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);

export async function executeValidationSteps({ steps, run, snapshot, save, initialSnapshot }) {
  const receipt = {
    startedAt: new Date().toISOString(),
    status: "running",
    inputSnapshot: initialSnapshot ?? (await snapshot()),
    steps: [],
  };
  await save(receipt);
  const checkInputs = async () => {
    if ((await snapshot()) !== receipt.inputSnapshot) {
      receipt.failedStep = "input-snapshot";
      throw new Error("Input files changed during verification; rerun against a stable snapshot.");
    }
  };
  try {
    for (const step of steps) {
      await checkInputs();
      const result = { id: step.id, status: "running", startedAt: new Date().toISOString() };
      receipt.steps.push(result);
      await save(receipt);
      const start = Date.now();
      try {
        await run(step);
        result.status = "passed";
      } catch (error) {
        result.status = "failed";
        result.error = error instanceof Error ? error.message : String(error);
        receipt.failedStep = step.id;
        throw error;
      } finally {
        result.durationMs = Date.now() - start;
      }
      await checkInputs();
      await save(receipt);
    }
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = error instanceof Error ? error.message : String(error);
  }
  receipt.completedAt = new Date().toISOString();
  await save(receipt);
  return receipt;
}

export async function collectPreFilingInputs(repositoryRoot = root) {
  const verificationDependencies = new Set([
    "scripts/vitest-browser-storage-setup.ts",
    ".prettierignore",
  ]);
  const { stdout } = await exec(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 },
  );
  const files = [...new Set([...stdout.split("\0"), ...verificationDependencies])]
    .filter(
      (path) =>
        verificationDependencies.has(path) ||
        (/^(?:apps\/(?:miniprogram|web|api)\/|packages\/(?:learning-domain|cloud-contracts)\/|supabase\/migrations\/|scripts\/(?:verify-pre-filing|pre-filing-checks|check-pre-filing-artifacts|build-pre-filing-web)|(?:pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|vitest.*config\.ts|tsconfig.*\.json|eslint\.config\.mjs|prettier\.config\.mjs|playwright\.pre-filing\.config\.mjs)$)/u.test(
          path,
        ) &&
          /\.(?:ts|tsx|mjs|cjs|js|css|html|json|sql|ya?ml)$/u.test(path)),
    )
    .sort();
  const manifest = {};
  for (const path of files) {
    try {
      manifest[path] = createHash("sha256")
        .update(await readFile(resolve(repositoryRoot, path)))
        .digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      manifest[path] = "deleted";
    }
  }
  return manifest;
}

function localEnvironment(overrides) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:VITE_|HUAYI_MINIPROGRAM_|HUAYI_WECHAT_)/u.test(key),
    ),
  );
  return { ...env, ...overrides };
}

async function runCommand(step, output) {
  const log = resolve(output, `${step.id}.log`);
  await writeFile(log, `$ ${step.executable} ${step.args.join(" ")}\n`);
  process.stdout.write(`Checking ${step.id}…\n`);
  let writes = Promise.resolve();
  await new Promise((accept, reject) => {
    const child = spawn(step.executable, step.args, {
      cwd: root,
      env: localEnvironment(step.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk) => {
      writes = writes.then(() => appendFile(log, chunk));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      writes.then(
        () =>
          code === 0 && signal === null
            ? accept()
            : reject(new Error(`${step.id} exited ${code ?? signal}; see ${log}`)),
        reject,
      );
    });
  });
}

async function main() {
  const output = resolve(
    root,
    "artifacts/pre-filing-validation",
    new Date().toISOString().replaceAll(":", "-"),
  );
  const steps = preFilingChecks(output);
  if (process.argv.slice(2).length > 0) {
    if (process.argv.length !== 3 || process.argv[2] !== "--list")
      throw new Error("Usage: node scripts/verify-pre-filing.mjs [--list]");
    process.stdout.write(
      `${steps.map(({ id, executable, args }) => `${id}: ${executable} ${args.join(" ")}`).join("\n")}\n`,
    );
    return;
  }
  await mkdir(output, { recursive: true });
  const manifest = await collectPreFilingInputs();
  await writeFile(resolve(output, "inputs.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const metadata = {
    scope: "pre-filing local validation; not device, hosted or release acceptance",
    commands: steps,
    sourceManifest: "inputs.json",
    node: process.version,
    head: (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(),
    output,
  };
  const receipt = await executeValidationSteps({
    steps,
    initialSnapshot: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    run: (step) => runCommand(step, output),
    snapshot: async () =>
      createHash("sha256")
        .update(JSON.stringify(await collectPreFilingInputs()))
        .digest("hex"),
    save: (state) =>
      writeFile(
        resolve(output, "receipt.json"),
        `${JSON.stringify({ ...metadata, ...state }, null, 2)}\n`,
      ),
  });
  process.stdout.write(`${receipt.status}: ${resolve(output, "receipt.json")}\n`);
  if (receipt.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
