import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { auditHtml } from "./store-html-audit.mjs";

const EXPECTED_FILES = new Set([
  "icon-16.png",
  "icon-48.png",
  "icon-128.png",
  "brand-theme.css",
  "content-script.js",
  "manifest.json",
  "options.css",
  "options-components.css",
  "options-site-rules.css",
  "page-ui.css",
  "options.html",
  "options.js",
  "overlay.css",
  "shanbay-lemma-licenses.txt",
  "popup.css",
  "popup.html",
  "popup.js",
  "service-worker.js",
  "youtube-content.js",
  "youtube-main.js",
]);
const EXPECTED_PERMISSIONS = ["alarms", "storage", "unlimitedStorage"];
const EXPECTED_HOSTS = [
  "https://api.openai.com/*",
  "https://api.deepseek.com/*",
  "https://api.frdic.com/*",
];
const EXPECTED_CSP =
  "script-src 'self'; object-src 'self'; connect-src https://api.openai.com https://api.deepseek.com https://api.frdic.com";
const EXPECTED_CONTENT_SCRIPTS = [
  {
    all_frames: false,
    js: ["content-script.js"],
    matches: ["http://*/*", "https://*/*"],
    run_at: "document_idle",
  },
  {
    all_frames: false,
    js: ["youtube-content.js"],
    matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
    run_at: "document_idle",
  },
  {
    all_frames: false,
    js: ["youtube-main.js"],
    matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
    run_at: "document_start",
    world: "MAIN",
  },
];
const EXPECTED_WEB_ACCESSIBLE_RESOURCES = [
  { matches: ["http://*/*", "https://*/*"], resources: ["overlay.css"] },
];
const CLASSIC_MARKERS = [
  /@huayi\/protocol/iu,
  /native[- ]?messaging/iu,
  /native[- ]?host/iu,
  /openai-compatible/iu,
  /compatible-http/iu,
  /\bcodex\b/iu,
  /\bdpapi\b/iu,
  /\bkeychain\b/iu,
];

function toPosix(value) {
  return value.split(sep).join("/");
}

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path, base) : [toPosix(relative(base, path))];
    }),
  );
  return nested.flat().sort();
}

function parseJson(value, label, violations) {
  try {
    return JSON.parse(value);
  } catch {
    violations.push(`${label} is not valid JSON.`);
    return null;
  }
}

function auditManifest(manifest, violations, { expectedCsp, expectedHosts }) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return;
  if (manifest.manifest_version !== 3) violations.push("Store package must use Manifest V3.");
  try {
    assert.deepEqual(manifest.permissions, EXPECTED_PERMISSIONS);
  } catch {
    violations.push("Store package does not use the reviewed permissions.");
  }
  try {
    assert.deepEqual(manifest.host_permissions, expectedHosts);
  } catch {
    violations.push("Store package does not use the reviewed API hosts.");
  }
  if (manifest.content_security_policy?.extension_pages !== expectedCsp) {
    violations.push("Store package CSP is not the reviewed self-only policy.");
  }
  if (manifest.incognito !== "not_allowed") {
    violations.push("Store package must remain unavailable in incognito mode.");
  }
  try {
    assert.deepEqual(manifest.background, {
      service_worker: "service-worker.js",
      type: "module",
    });
    assert.deepEqual(manifest.icons, { 16: "icon-16.png", 48: "icon-48.png", 128: "icon-128.png" });
    assert.deepEqual(manifest.action, { default_popup: "popup.html" });
    assert.deepEqual(manifest.options_ui, { open_in_tab: true, page: "options.html" });
    assert.deepEqual(manifest.content_scripts, EXPECTED_CONTENT_SCRIPTS);
    assert.deepEqual(manifest.web_accessible_resources, EXPECTED_WEB_ACCESSIBLE_RESOURCES);
  } catch {
    violations.push("Store package entrypoints differ from the reviewed package boundary.");
  }
  for (const forbidden of [
    "externally_connectable",
    "optional_host_permissions",
    "optional_permissions",
    "sandbox",
    "update_url",
  ]) {
    if (Object.hasOwn(manifest, forbidden)) {
      violations.push(`Store package manifest must not declare ${forbidden}.`);
    }
  }
}

function isIdentifierReference(node) {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (
    ((ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isParameter(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent)) &&
      parent.name === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    ((ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
      parent.label === node)
  ) {
    return false;
  }
  return true;
}

function auditJavaScript(path, contents, violations) {
  const parsed = ts.createSourceFile(
    path,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const findings = new Set();
  const dataNames = [];
  const lemmaConstants = [];
  const references = new Map();
  const forbiddenReferences = new Map([
    ["eval", "eval is forbidden."],
    ["Function", "Function constructor is forbidden."],
    ["importScripts", "importScripts is forbidden."],
  ]);
  const pending = [parsed];
  while (pending.length > 0) {
    const node = pending.pop();
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      findings.add("dynamic import is forbidden.");
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === "codex"
    )
      lemmaConstants.push(node);
    if (ts.isIdentifier(node) && isIdentifierReference(node)) {
      const occurrences = references.get(node.text) ?? [];
      occurrences.push(node);
      references.set(node.text, occurrences);
      const finding = forbiddenReferences.get(node.text);
      if (finding !== undefined) findings.add(finding);
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression !== undefined &&
      (ts.isStringLiteral(node.argumentExpression) ||
        ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
    ) {
      const finding = forbiddenReferences.get(node.argumentExpression.text);
      if (finding !== undefined) findings.add(finding);
    }
    // Numeric dictionary entries (for example WordNet's word "codex") are inert data.
    // Keep auditing every reference and every executable expression without exceptions.
    const dataName =
      ts.isPropertyAssignment(node) && ts.isNumericLiteral(node.initializer)
        ? node.name
        : ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) &&
            ts.isNumericLiteral(node.right)
          ? node.left.name
          : null;
    if (
      dataName &&
      (ts.isIdentifier(dataName) || ts.isStringLiteral(dataName)) &&
      dataName.text === "codex"
    )
      dataNames.push([dataName.getStart(parsed), dataName.end]);
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  // The pinned WordNet noun exception maps codices to the ordinary noun codex.
  // Only mask a constant used exclusively in that data assignment; executable uses stay visible.
  for (const declaration of lemmaConstants) {
    let scope = declaration.parent;
    while (scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    const occurrences = (references.get(declaration.name.text) ?? []).filter(
      (node) => node.pos >= scope.pos && node.end <= scope.end,
    );
    if (
      occurrences.length > 0 &&
      occurrences.every((node) => {
        const assignment = node.parent;
        return (
          ts.isBinaryExpression(assignment) &&
          assignment.right === node &&
          assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(assignment.left) &&
          assignment.left.name.text === "codices"
        );
      })
    )
      dataNames.push([declaration.initializer.getStart(parsed), declaration.initializer.end]);
  }
  for (const finding of findings) violations.push(`${path}: ${finding}`);
  let previous = 0;
  const fragments = [];
  for (const [start, end] of dataNames.sort((a, b) => a[0] - b[0])) {
    fragments.push(contents.slice(previous, start), " ");
    previous = end;
  }
  return fragments.join("") + contents.slice(previous);
}

function auditExecutable(path, contents, violations) {
  if (/\.html$/u.test(path)) {
    auditHtml(path, contents, violations);
  }
  if (/\.css$/u.test(path) && /@import\s+(?:url\()?\s*["']?https?:\/\//iu.test(contents)) {
    violations.push(`${path}: remote executable code is forbidden.`);
  }
  if (/\.js$/u.test(path)) {
    return auditJavaScript(path, contents, violations);
  }
  return contents;
}

export async function auditStoreRelease(
  repositoryRoot,
  {
    expectedCsp = EXPECTED_CSP,
    expectedHosts = EXPECTED_HOSTS,
    sourceManifestName = "manifest.json",
  } = {},
) {
  if (
    !new Set(["manifest.hosted-acceptance.json", "manifest.production.json", "manifest.json"]).has(
      sourceManifestName,
    )
  ) {
    throw new Error("Store release source manifest is invalid.");
  }
  const root = resolve(repositoryRoot);
  const extensionRoot = resolve(root, "apps/store-extension");
  const dist = resolve(
    extensionRoot,
    sourceManifestName === "manifest.hosted-acceptance.json"
      ? "dist"
      : sourceManifestName === "manifest.production.json"
        ? "dist-production"
        : "dist-release",
  );
  const violations = [];
  let files;
  try {
    files = await listFiles(dist);
  } catch (error) {
    if (error?.code === "ENOENT") return ["Store dist is missing; run the build first."];
    throw error;
  }
  for (const file of files) {
    if (!EXPECTED_FILES.has(file)) violations.push(`${file}: unexpected package artifact.`);
  }
  for (const expected of EXPECTED_FILES) {
    if (!files.includes(expected))
      violations.push(`${expected}: required package artifact is missing.`);
  }

  const sourceManifestText = await readFile(resolve(extensionRoot, sourceManifestName), "utf8");
  const packagedManifestText = await readFile(resolve(dist, "manifest.json"), "utf8");
  const sourceManifest = parseJson(sourceManifestText, "Store source manifest", violations);
  const packagedManifest = parseJson(packagedManifestText, "Store packaged manifest", violations);
  try {
    assert.deepEqual(packagedManifest, sourceManifest);
  } catch {
    violations.push("Store packaged manifest differs from the source manifest.");
  }
  auditManifest(packagedManifest, violations, { expectedCsp, expectedHosts });

  for (const file of files) {
    if (file.endsWith(".png")) {
      const bytes = await readFile(resolve(dist, file));
      const expectedSize = Number(file.match(/^icon-(16|48|128)\.png$/)?.[1]);
      if (
        bytes.length < 24 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.readUInt32BE(16) !== expectedSize ||
        bytes.readUInt32BE(20) !== expectedSize ||
        !bytes.equals(await readFile(resolve(extensionRoot, "assets", file)))
      ) {
        violations.push(`${file}: packaged icon must match the reviewed PNG and dimensions.`);
      }
      continue;
    }
    const contents = await readFile(resolve(dist, file), "utf8");
    const executable = auditExecutable(file, contents, violations);
    for (const marker of CLASSIC_MARKERS) {
      if (marker.test(file) || marker.test(executable)) {
        violations.push(`${file}: Classic-only marker is forbidden in Store package.`);
        break;
      }
    }
  }
  return [...new Set(violations)].sort();
}

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = await auditStoreRelease(repositoryRoot);
  if (violations.length === 0) return;
  for (const violation of violations) process.stderr.write(`${violation}\n`);
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Store release audit failed."}\n`,
    );
    process.exitCode = 1;
  });
}
