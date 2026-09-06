import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { readWebDeploymentConfig } from "./web-deployment-config.mjs";

const SERVER_SECRET_MARKERS = [
  "CRON_SECRET",
  "HUAYI_DATABASE_URL",
  "HUAYI_DATABASE_TLS_CA_BASE64",
  "HUAYI_DEEPSEEK_API_KEY",
  "HUAYI_REFRESH_ENCRYPTION_KEY",
  "HUAYI_RESEND_API_KEY",
  "HUAYI_SECRET_PEPPER",
  "SUPABASE_SERVICE_ROLE_KEY",
];
function toPosix(value) {
  return value.split(sep).join("/");
}

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path, base) : [toPosix(relative(base, path))];
    }),
  );
  return files.flat().sort();
}

function hasRemoteOrInlineCode(index) {
  return (
    /(?:src|href)\s*=\s*["'](?:https?:)?\/\//iu.test(index) ||
    /<script\b(?![^>]*\bsrc\s*=)[^>]*>/iu.test(index) ||
    /\son[a-z]+\s*=/iu.test(index)
  );
}

export async function auditWebRelease(root, profile = "hosted-acceptance") {
  const violations = [];
  const dist = resolve(root, "apps/web/dist");
  const files = await listFiles(dist);
  const contents = await Promise.all(
    files.map(async (file) => ({ file, text: await readFile(resolve(dist, file), "utf8") })),
  );
  const index = contents.find((entry) => entry.file === "index.html")?.text ?? "";
  if (hasRemoteOrInlineCode(index)) violations.push("web-remote-code");
  if (
    contents.some((entry) => SERVER_SECRET_MARKERS.some((marker) => entry.text.includes(marker)))
  ) {
    violations.push("web-server-secret");
  }
  const bundle = contents.map((entry) => entry.text).join("\n");
  if (
    !bundle.includes("语见 Cloud V1 隐私说明") ||
    !bundle.includes("Chrome Web Store User Data Policy")
  ) {
    violations.push("web-privacy-artifact");
  }
  const vercel = readWebDeploymentConfig(root, profile);
  if (
    !Array.isArray(vercel.rewrites) ||
    !vercel.rewrites.some(
      (rewrite) => rewrite?.source === "/(.*)" && rewrite?.destination === "/index.html",
    )
  ) {
    violations.push("web-privacy-artifact");
  }
  return violations;
}
