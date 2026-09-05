import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const SOURCE_ROOTS = [
  "apps/extension/src",
  "apps/native-host/src",
  "apps/store-extension/src",
  "apps/api/src",
  "apps/web/src",
  "packages/protocol/src",
  "packages/store-domain/src",
  "packages/learning-domain/src",
  "packages/cloud-contracts/src",
];
const CYCLE_AND_SIZE_ROOTS = [
  "apps/store-extension/src",
  "packages/store-domain/src",
  "apps/api/src",
  "apps/web/src",
  "packages/learning-domain/src",
  "packages/cloud-contracts/src",
];

const PACKAGE_RULES = [
  { allowedHuayi: new Set(["@huayi/protocol"]), root: "apps/extension/src" },
  { allowedHuayi: new Set(["@huayi/protocol"]), root: "apps/native-host/src" },
  {
    allowedHuayi: new Set(["@huayi/cloud-contracts", "@huayi/store-domain"]),
    root: "apps/store-extension/src",
  },
  { allowedHuayi: new Set(["@huayi/cloud-contracts"]), root: "apps/api/src" },
  { allowedHuayi: new Set(["@huayi/cloud-contracts"]), root: "apps/web/src" },
  { allowedHuayi: new Set(), root: "packages/protocol/src" },
  { allowedHuayi: new Set(["@huayi/learning-domain"]), root: "packages/store-domain/src" },
  { allowedHuayi: new Set(), root: "packages/learning-domain/src" },
  { allowedHuayi: new Set(["@huayi/learning-domain"]), root: "packages/cloud-contracts/src" },
];
function toPosix(value) {
  return value.split(sep).join("/");
}

async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function listTypeScriptFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(path);
      return /\.(?:mts|tsx|ts)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

function isProductionSource(file) {
  return !/\.(?:spec|test)\.(?:mts|tsx|ts)$/u.test(file);
}

function moduleSpecifiers(source, file) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

function packageName(specifier) {
  if (!specifier.startsWith("@huayi/")) return null;
  return specifier.split("/").slice(0, 2).join("/");
}

function ruleForFile(root, file) {
  return PACKAGE_RULES.find((rule) => {
    const directory = resolve(root, rule.root);
    return file === directory || file.startsWith(`${directory}${sep}`);
  });
}

async function resolveRelativeImport(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  const unresolved = resolve(dirname(file), specifier);
  const extension = extname(unresolved);
  const stem =
    extension === ".js" || extension === ".mjs"
      ? unresolved.slice(0, -extension.length)
      : unresolved;
  for (const candidate of [
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    resolve(unresolved, "index.ts"),
  ]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function cycleViolations(graph, root) {
  const state = new Map();
  const stack = [];
  const seenCycles = new Set();
  const violations = [];
  const visit = (file) => {
    state.set(file, "visiting");
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) {
      if (!graph.has(dependency)) continue;
      if (state.get(dependency) === "visiting") {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency].map((value) =>
          toPosix(relative(root, value)),
        );
        const key = [...new Set(cycle.slice(0, -1))].sort().join("|");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          violations.push(`Production dependency cycle: ${cycle.join(" -> ")}`);
        }
      } else if (state.get(dependency) === undefined) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(file, "visited");
  };
  for (const file of [...graph.keys()].sort()) {
    if (state.get(file) === undefined) visit(file);
  }
  return violations;
}

function boundaryViolation(rule, specifier, path) {
  const dependency = packageName(specifier);
  if (dependency === null) return null;
  if (specifier !== dependency) {
    return `${path}: cross-package imports must use the public package export (${specifier}).`;
  }
  if (!rule.allowedHuayi.has(dependency)) {
    if (rule.root === "apps/store-extension/src") {
      return `${path}: Store Extension may import only @huayi/cloud-contracts or @huayi/store-domain (${specifier}).`;
    }
    return `${path}: package boundary forbids ${specifier}.`;
  }
  return null;
}

export async function collectArchitectureViolations(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map((sourceRoot) => listTypeScriptFiles(resolve(root, sourceRoot))),
    )
  ).flat();
  const production = files.filter(isProductionSource);
  const cycleFiles = production.filter((file) =>
    CYCLE_AND_SIZE_ROOTS.some((sourceRoot) => {
      const directory = resolve(root, sourceRoot);
      return file === directory || file.startsWith(`${directory}${sep}`);
    }),
  );
  const productionSet = new Set(cycleFiles);
  const graph = new Map(cycleFiles.map((file) => [file, new Set()]));
  const violations = [];

  for (const file of production) {
    const path = toPosix(relative(root, file));
    const source = await readFile(file, "utf8");
    const rule = ruleForFile(root, file);
    if (rule === undefined) continue;
    if (
      CYCLE_AND_SIZE_ROOTS.some((sourceRoot) => {
        const directory = resolve(root, sourceRoot);
        return file === directory || file.startsWith(`${directory}${sep}`);
      }) &&
      source.split(/\r?\n/u).length - 1 > 400
    ) {
      violations.push(`${path}: handwritten production source exceeds 400 lines.`);
    }
    for (const specifier of moduleSpecifiers(source, file)) {
      const packageViolation = boundaryViolation(rule, specifier, path);
      if (packageViolation !== null) violations.push(packageViolation);
      if (
        (rule.root === "packages/store-domain/src" ||
          rule.root === "packages/learning-domain/src") &&
        !specifier.startsWith(".") &&
        specifier !== "zod" &&
        specifier !== "zod/v3" &&
        !(
          rule.root === "packages/store-domain/src" &&
          (specifier === "@huayi/learning-domain" || specifier === "tldts")
        )
      ) {
        const domainName =
          rule.root === "packages/learning-domain/src" ? "Learning domain" : "Store domain";
        violations.push(`${path}: ${domainName} must remain platform-neutral (${specifier}).`);
      }
      const dependency = await resolveRelativeImport(file, specifier);
      if (dependency !== null && productionSet.has(dependency)) graph.get(file)?.add(dependency);
    }
  }

  violations.push(...cycleViolations(graph, root));
  return [...new Set(violations)].sort();
}

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = await collectArchitectureViolations(repositoryRoot);
  if (violations.length === 0) return;
  for (const violation of violations) process.stderr.write(`${violation}\n`);
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Architecture check failed."}\n`,
    );
    process.exitCode = 1;
  });
}
