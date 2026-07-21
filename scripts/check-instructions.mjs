import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootInstructions = "AGENTS.md";
const moduleInstructions = [
  "apps/extension/AGENTS.md",
  "apps/native-host/AGENTS.md",
  "packages/protocol/AGENTS.md",
];
const requiredCommands = [
  "pnpm install",
  "pnpm check:instructions",
  "pnpm format:check",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "pnpm test:e2e",
  "pnpm build",
  "pnpm verify:macos",
  "pnpm verify:windows",
  "pnpm smoke:codex",
  "pnpm host:install -- --extension-id <ID>",
  "pnpm host:uninstall",
  "pnpm host:windows:package",
];
const requiredRootFragments = [
  "## Cross-platform development",
  "docs/cross-platform-development.md",
  "implemented; target-platform validation pending",
];

const errors = [];

async function readInstructions(path) {
  const absolutePath = resolve(repositoryRoot, path);

  try {
    const [content, metadata] = await Promise.all([
      readFile(absolutePath, "utf8"),
      stat(absolutePath),
    ]);

    return { content, size: metadata.size };
  } catch {
    errors.push(`Missing instruction file: ${path}`);
    return { content: "", size: 0 };
  }
}

function checkMaximum(path, size, maximum) {
  if (size > maximum) {
    errors.push(`${path} is ${size} bytes; maximum is ${maximum} bytes.`);
  }
}

const root = await readInstructions(rootInstructions);
checkMaximum(rootInstructions, root.size, 12 * 1024);

for (const command of requiredCommands) {
  if (!root.content.includes(`\`${command}\``)) {
    errors.push(`${rootInstructions} is missing required command: ${command}`);
  }
}

for (const fragment of requiredRootFragments) {
  if (!root.content.includes(fragment)) {
    errors.push(`${rootInstructions} is missing cross-platform rule: ${fragment}`);
  }
}

const instructionChains = [[rootInstructions]];

for (const modulePath of moduleInstructions) {
  const module = await readInstructions(modulePath);
  checkMaximum(modulePath, module.size, 6 * 1024);

  if (root.size + module.size > 32 * 1024) {
    errors.push(`${rootInstructions} plus ${modulePath} exceeds the 32 KiB instruction limit.`);
  }

  instructionChains.push([rootInstructions, modulePath]);
}

if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`ERROR: ${error}\n`);
  }

  process.exitCode = 1;
} else {
  process.stdout.write("Instruction files are valid. Effective load order:\n");

  for (const chain of instructionChains) {
    const target = dirname(chain.at(-1));
    const displayTarget = target === "." ? "." : target;
    process.stdout.write(`- ${displayTarget}: ${chain.join(" -> ")}\n`);
  }

  process.stdout.write("Checked the repository root and three module directories.\n");
}
