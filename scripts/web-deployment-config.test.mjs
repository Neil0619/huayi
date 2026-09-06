import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readWebDeploymentConfig } from "./web-deployment-config.mjs";

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
