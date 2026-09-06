import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { readWebDeploymentConfig } from "./web-deployment-config.mjs";

// Git deployment intake happens before programmatic config execution. Model the conservative
// literal-only boundary here: computed expressions remain unavailable until the build. This is
// a source-structure guard, not a replacement for the provider's actual deployment validation.
function literalConfigValue(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalConfigValue);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.flatMap((property) => {
        if (!ts.isPropertyAssignment(property)) return [];
        const value = literalConfigValue(property.initializer);
        return value === undefined ? [] : [[property.name.text, value]];
      }),
    );
  }
  return undefined;
}

test("pre-build config never exposes a response header without its computed value", async () => {
  const source = ts.createSourceFile(
    "vercel.mjs",
    await readFile("apps/web/vercel.mjs", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .filter((statement) =>
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    )
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((item) => item.name.getText(source) === "config");
  assert(declaration?.initializer);
  const config = literalConfigValue(declaration.initializer);
  assert.equal(config.framework, "vite");
  assert.equal(config.buildCommand, "pnpm build:vercel");
  assert.deepEqual(config.git, { deploymentEnabled: false });
  assert.equal(config.outputDirectory, "dist");
  for (const rule of config.headers ?? []) {
    assert.equal(typeof rule.source, "string");
    for (const header of rule.headers) {
      assert.equal(typeof header.key, "string");
      assert.equal(typeof header.value, "string", `${header.key} is incomplete before the build`);
    }
  }
});

test("actual Web deployment config isolates CSP origins and preserves routing and security headers", async () => {
  const acceptance = await readWebDeploymentConfig(process.cwd(), "hosted-acceptance");
  const production = await readWebDeploymentConfig(process.cwd(), "production");
  for (const [config, api, supabase] of [
    [acceptance, "https://api.acceptance.seen-said.cn", "https://kpadiulxkgckskcfydry.supabase.co"],
    [production, "https://api.seen-said.cn", "https://pxqqgxfumovegbcxnmzb.supabase.co"],
  ]) {
    assert.deepEqual(config.git, { deploymentEnabled: false });
    assert.deepEqual(config.rewrites, [{ destination: "/index.html", source: "/(.*)" }]);
    assert.equal(config.framework, "vite");
    assert.equal(config.buildCommand, "pnpm build:vercel");
    assert.equal(config.outputDirectory, "dist");
    assert.deepEqual(config.headers, [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'none'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "frame-src 'none'",
              "worker-src 'none'",
              "script-src 'self'",
              "style-src 'self'",
              "font-src 'self'",
              "img-src 'self' data:",
              `connect-src 'self' ${api}`,
              `form-action 'self' ${api} ${supabase}${config === acceptance ? " https://accounts.google.com" : ""}`,
              "manifest-src 'self'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]);
  }
  assert.equal(JSON.stringify(production).includes("acceptance"), false);
  assert.equal(JSON.stringify(production).includes("kpadiulxkgckskcfydry"), false);
  assert.equal(JSON.stringify(acceptance).includes("pxqqgxfumovegbcxnmzb"), false);
});

test("config reader executes the selected candidate's configuration and keeps errors private", async () => {
  const root = await mkdtemp(join(tmpdir(), "seen-said-web-config-"));
  try {
    await mkdir(join(root, "apps/web"), { recursive: true });
    await writeFile(
      join(root, "apps/web/vercel.mjs"),
      "export const config = {git:{deploymentEnabled:true}};",
    );
    assert.deepEqual(await readWebDeploymentConfig(root, "production"), {
      git: { deploymentEnabled: true },
    });
    await writeFile(
      join(root, "apps/web/vercel.mjs"),
      'throw new Error("fictional-private-error");',
    );
    assert.throws(() => readWebDeploymentConfig(root, "production"), {
      message: "Web deployment configuration is invalid.",
    });
    assert.throws(() => readWebDeploymentConfig(root, "unknown"), {
      message: "Web deployment configuration is invalid.",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actual Vercel entry rejects unknown or crossed deployment profiles", () => {
  for (const environment of [
    { VITE_DEPLOYMENT_ENVIRONMENT: "preview" },
    { VITE_API_ORIGIN: "https://api.seen-said.cn" },
    {
      VITE_DEPLOYMENT_ENVIRONMENT: "production",
      VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
    },
    {
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
      VITE_API_ORIGIN: "https://api.seen-said.cn",
    },
  ]) {
    assert.throws(() =>
      execFileSync(process.execPath, ["apps/web/vercel.mjs"], {
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5_000,
      }),
    );
  }
});
