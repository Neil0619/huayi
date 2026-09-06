import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

const profiles = Object.freeze({
  release: { directory: "dist-release", manifest: "manifest.json" },
  "hosted-acceptance": { directory: "dist", manifest: "manifest.hosted-acceptance.json" },
  production: { directory: "dist-production", manifest: "manifest.production.json" },
});

export function storeProfilePaths(profile = "release") {
  if (!Object.hasOwn(profiles, profile)) throw new Error("Store build configuration is invalid.");
  return profiles[profile];
}

function consumedProfileValues(source) {
  const file = ts.createSourceFile("service-worker.ts", source, ts.ScriptTarget.Latest, true);
  const imports = file.statements.filter(
    (node) =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "./cloud-build-profile.js",
  );
  const namespaces = imports.flatMap((node) => {
    const binding = node.importClause?.namedBindings;
    return binding && ts.isNamespaceImport(binding) ? [binding.name.text] : [];
  });
  const used = new Set();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const position =
        node.expression.text === "createProductionCloudClients"
          ? 0
          : node.expression.text === "handleOpenWebWorkspace"
            ? 3
            : -1;
      const argument = node.arguments[position];
      if (
        argument &&
        ts.isPropertyAccessExpression(argument) &&
        ts.isIdentifier(argument.expression) &&
        namespaces.includes(argument.expression.text)
      ) {
        used.add(`${node.expression.text}:${argument.name.text}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return {
    apiConsumed: used.has("createProductionCloudClients:HUAYI_CLOUD_API_ORIGIN"),
    workspaceConsumed: used.has("handleOpenWebWorkspace:HUAYI_WEB_WORKSPACE_URL"),
  };
}

export function readStoreCloudBuild(repositoryRoot, profile = "release") {
  try {
    const paths = storeProfilePaths(profile);
    const program = `
      import { readFile } from "node:fs/promises";
      import { resolve } from "node:path";
      import { loadConfigFromFile, transformWithEsbuild } from ${JSON.stringify(import.meta.resolve("vite"))};
      const root = process.argv[1];
      const selected = await loadConfigFromFile({ command: "build", mode: "background" },
        resolve(root, "apps/store-extension/vite.config.ts"), root, "silent");
      if (!selected) throw new Error();
      const source = await readFile(resolve(root, "apps/store-extension/src/service-worker/cloud-build-profile.ts"), "utf8");
      const compiled = await transformWithEsbuild(source, "cloud-build-profile.ts", {
        define: selected.config.define, format: "esm",
      });
      const runtime = await import("data:text/javascript;base64," + Buffer.from(compiled.code).toString("base64"));
      process.stdout.write(JSON.stringify({
        apiOrigin: runtime.HUAYI_CLOUD_API_ORIGIN,
        webOrigin: runtime.HUAYI_WEB_ORIGIN,
        workspaceUrl: runtime.HUAYI_WEB_WORKSPACE_URL,
        outDir: selected.config.build?.outDir,
      }));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", program, repositoryRoot],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        shell: false,
        timeout: 10_000,
        maxBuffer: 65_536,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...Object.fromEntries(
            ["PATH", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"].flatMap(
              (name) => (typeof process.env[name] === "string" ? [[name, process.env[name]]] : []),
            ),
          ),
          HUAYI_STORE_BUILD_PROFILE: profile,
        },
      },
    );
    const result = JSON.parse(output);
    for (const field of ["apiOrigin", "webOrigin", "workspaceUrl"]) {
      if (
        result[field] !== null &&
        (typeof result[field] !== "string" || result[field].length > 256)
      ) {
        throw new Error();
      }
    }
    if (result.outDir !== resolve(repositoryRoot, "apps/store-extension", paths.directory))
      throw new Error();
    const consumer = readFileSync(
      resolve(repositoryRoot, "apps/store-extension/src/service-worker/service-worker.ts"),
      "utf8",
    );
    return { ...result, ...consumedProfileValues(consumer) };
  } catch {
    throw new Error("Store build configuration is invalid.");
  }
}
