import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const EXPECTED_FILES = new Set([
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
  const forbiddenReferences = new Map([
    ["eval", "eval is forbidden."],
    ["Function", "Function constructor is forbidden."],
    ["importScripts", "importScripts is forbidden."],
  ]);
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      findings.add("dynamic import is forbidden.");
    }
    if (ts.isIdentifier(node) && isIdentifierReference(node)) {
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
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  for (const finding of findings) violations.push(`${path}: ${finding}`);
}

function readStartTag(source, start) {
  let index = start + 1;
  if (!/[A-Za-z]/u.test(source[index] ?? "")) return null;
  const nameStart = index;
  while (/[A-Za-z0-9:-]/u.test(source[index] ?? "")) index += 1;
  const name = source.slice(nameStart, index).toLowerCase();
  const attributes = [];
  while (index < source.length) {
    while (/\s/u.test(source[index] ?? "")) index += 1;
    if (source[index] === ">") return { attributes, end: index, name };
    if (source[index] === "/" && source[index + 1] === ">") {
      return { attributes, end: index + 1, name };
    }
    const attributeStart = index;
    while (index < source.length && !/[\s=/>]/u.test(source[index] ?? "")) index += 1;
    if (attributeStart === index) {
      index += 1;
      continue;
    }
    const attributeName = source.slice(attributeStart, index).toLowerCase();
    while (/\s/u.test(source[index] ?? "")) index += 1;
    let value = null;
    if (source[index] === "=") {
      index += 1;
      while (/\s/u.test(source[index] ?? "")) index += 1;
      const quote = source[index] === '"' || source[index] === "'" ? source[index] : null;
      if (quote !== null) {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        value = source.slice(valueStart, index);
        if (source[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !/[\s>]/u.test(source[index] ?? "")) index += 1;
        value = source.slice(valueStart, index);
      }
    }
    attributes.push({ name: attributeName, value });
  }
  return { attributes, end: source.length - 1, name };
}

function findClosingTag(lowerSource, name, start) {
  let index = lowerSource.indexOf(`</${name}`, start);
  while (index !== -1) {
    const boundary = lowerSource[index + name.length + 2];
    if (boundary === ">" || /\s/u.test(boundary ?? "")) return index;
    index = lowerSource.indexOf(`</${name}`, index + 2);
  }
  return lowerSource.length;
}

function attributeValue(tag, name) {
  return tag.attributes.find((attribute) => attribute.name === name)?.value;
}

function isExecutableScriptType(tag) {
  const type = attributeValue(tag, "type")?.trim().toLowerCase();
  if (type === undefined || type === "" || type === "module" || type === "importmap") return true;
  const mime = type.split(";", 1)[0]?.trim() ?? "";
  return /(?:java|ecma)script|jscript|livescript/u.test(mime);
}

function isLocalScriptSource(value) {
  if (value === null || value.trim() === "") return false;
  const source = value.trim();
  return !source.startsWith("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source);
}

function auditHtml(path, contents, violations) {
  const lowerContents = contents.toLowerCase();
  const rawTextTags = new Set([
    "iframe",
    "noembed",
    "noframes",
    "script",
    "style",
    "textarea",
    "title",
  ]);
  let index = 0;
  while (index < contents.length) {
    const start = contents.indexOf("<", index);
    if (start === -1) break;
    if (contents.startsWith("<!--", start)) {
      const commentEnd = contents.indexOf("-->", start + 4);
      index = commentEnd === -1 ? contents.length : commentEnd + 3;
      continue;
    }
    const tag = readStartTag(contents, start);
    if (tag === null) {
      index = start + 1;
      continue;
    }
    if (tag.attributes.some((attribute) => /^on[a-z]/u.test(attribute.name))) {
      violations.push(`${path}: inline event handler is forbidden.`);
    }
    if (tag.name === "script") {
      const sourceAttribute = tag.attributes.find((attribute) => attribute.name === "src");
      if (sourceAttribute !== undefined && !isLocalScriptSource(sourceAttribute.value)) {
        violations.push(`${path}: remote executable code is forbidden.`);
      }
      const closingStart = findClosingTag(lowerContents, tag.name, tag.end + 1);
      const inlineBody = contents.slice(tag.end + 1, closingStart);
      if (
        sourceAttribute === undefined &&
        isExecutableScriptType(tag) &&
        inlineBody.trim() !== ""
      ) {
        violations.push(`${path}: inline executable script is forbidden.`);
      }
      index = closingStart === contents.length ? contents.length : closingStart + 2;
      continue;
    }
    if (tag.name === "link") {
      const href = attributeValue(tag, "href")?.trim() ?? "";
      if (href.startsWith("//") || /^https?:\/\//iu.test(href)) {
        violations.push(`${path}: remote executable code is forbidden.`);
      }
    }
    if (rawTextTags.has(tag.name)) {
      const closingStart = findClosingTag(lowerContents, tag.name, tag.end + 1);
      index = closingStart === contents.length ? contents.length : closingStart + 2;
      continue;
    }
    index = tag.end + 1;
  }
}

function auditExecutable(path, contents, violations) {
  if (/\.html$/u.test(path)) {
    auditHtml(path, contents, violations);
  }
  if (/\.css$/u.test(path) && /@import\s+(?:url\()?\s*["']?https?:\/\//iu.test(contents)) {
    violations.push(`${path}: remote executable code is forbidden.`);
  }
  if (/\.js$/u.test(path)) {
    auditJavaScript(path, contents, violations);
  }
}

export async function auditStoreRelease(
  repositoryRoot,
  {
    expectedCsp = EXPECTED_CSP,
    expectedHosts = EXPECTED_HOSTS,
    sourceManifestName = "manifest.json",
  } = {},
) {
  if (!new Set(["manifest.hosted-acceptance.json", "manifest.json"]).has(sourceManifestName)) {
    throw new Error("Store release source manifest is invalid.");
  }
  const root = resolve(repositoryRoot);
  const extensionRoot = resolve(root, "apps/store-extension");
  const dist = resolve(
    extensionRoot,
    sourceManifestName === "manifest.hosted-acceptance.json" ? "dist" : "dist-release",
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
    const contents = await readFile(resolve(dist, file), "utf8");
    auditExecutable(file, contents, violations);
    for (const marker of CLASSIC_MARKERS) {
      if (marker.test(file) || marker.test(contents)) {
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
