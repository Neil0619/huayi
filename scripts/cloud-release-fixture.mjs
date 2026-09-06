import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const apiOrigin = "https://api.huayi.production";
export const webOrigin = "https://learn.huayi.production";
export const privacyUrl = `${webOrigin}/privacy`;
export const extensionId = "abcdefghijklmnopabcdefghijklmnop";
export const baseHosts = [
  "https://api.openai.com/*",
  "https://api.deepseek.com/*",
  "https://api.frdic.com/*",
];
export const expectedFiles = [
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
];

export function manifest() {
  const connectSources = [
    "https://api.openai.com",
    "https://api.deepseek.com",
    "https://api.frdic.com",
    apiOrigin,
  ].join(" ");
  return {
    action: { default_popup: "popup.html" },
    background: { service_worker: "service-worker.js", type: "module" },
    content_scripts: [
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
    ],
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${connectSources}`,
    },
    host_permissions: [...baseHosts, `${apiOrigin}/*`],
    incognito: "not_allowed",
    manifest_version: 3,
    name: "Huayi Cloud",
    options_ui: { open_in_tab: true, page: "options.html" },
    permissions: ["alarms", "storage", "unlimitedStorage"],
    version: "1.0.0",
    web_accessible_resources: [
      { matches: ["http://*/*", "https://*/*"], resources: ["overlay.css"] },
    ],
  };
}

export const configuration = {
  apiExtensionId: extensionId,
  apiOrigin,
  extensionId,
  minSupportedExtensionVersion: "1.0.0",
  privacyUrl,
  storeExtensionCapability: "enabled",
  webOrigin,
};

export async function write(directory, path, contents) {
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "huayi-cloud-release-"));
  const storeManifest = JSON.stringify(manifest());
  await write(root, "apps/store-extension/manifest.json", storeManifest);
  for (const file of expectedFiles) {
    const contents =
      file === "manifest.json"
        ? storeManifest
        : file === "service-worker.js"
          ? `const api=${JSON.stringify(apiOrigin)};const web=${JSON.stringify(`${webOrigin}/app`)};`
          : file.endsWith(".html")
            ? '<script type="module" src="./local.js"></script>'
            : "/* packaged */";
    await write(root, `apps/store-extension/dist-release/${file}`, contents);
  }
  await write(
    root,
    "apps/store-extension/src/service-worker/service-worker.ts",
    [
      'import * as profile from "./cloud-build-profile.js";',
      "createProductionCloudClients(profile.HUAYI_CLOUD_API_ORIGIN);",
      "handleOpenWebWorkspace(message, sender, runtime, profile.HUAYI_WEB_WORKSPACE_URL);",
    ].join("\n"),
  );
  await write(
    root,
    "apps/store-extension/src/service-worker/cloud-build-profile.ts",
    await readFile(
      new URL("../apps/store-extension/src/service-worker/cloud-build-profile.ts", import.meta.url),
      "utf8",
    ),
  );
  await write(
    root,
    "apps/store-extension/src/service-worker/web-workspace-handler.ts",
    "export function handleOpenWebWorkspace() {}",
  );
  await write(
    root,
    "apps/store-extension/vite.config.ts",
    `export default { define: ${JSON.stringify({
      HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE: JSON.stringify(apiOrigin),
      HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE: JSON.stringify(`${webOrigin}/app`),
      HUAYI_WEB_ORIGIN_BUILD_VALUE: JSON.stringify(webOrigin),
    })}, build: { outDir: ${JSON.stringify(join(root, "apps/store-extension/dist-release"))} } };`,
  );
  await write(
    root,
    "apps/web/dist/index.html",
    '<link rel="stylesheet" href="/assets/index.css"><script type="module" src="/assets/index.js"></script>',
  );
  await write(
    root,
    "apps/web/dist/assets/index.js",
    "语见 Cloud V1 隐私说明 Chrome Web Store User Data Policy Limited Use requirements",
  );
  await write(root, "apps/web/dist/assets/index.css", "body{color:#101a2d}");
  await write(
    root,
    "apps/web/vercel.mjs",
    `export const config = ${JSON.stringify({ rewrites: [{ destination: "/index.html", source: "/(.*)" }] })};`,
  );
  await write(
    root,
    "docs/cloud-v1/privacy-policy.md",
    [
      "# 语见 Cloud V1 隐私说明",
      "Chrome Web Store User Data Policy Limited Use requirements",
      "Cloud V1 不是端到端加密产品，华译服务器可读学习内容。",
      "BYOK 与欧路凭据只保存在本机。",
      "三项账号偏好对关联设备同步；平台与 BYOK 不自动互相回退。",
      "StudyCapture 只提交原始学习意图；本机词库与 CloudWordCopy 是相互独立的副本。",
      "用户可完整账号导出，删除账号后主数据库内容在 24 小时内删除。",
      "运营主体 Huayi；联系方式 privacy@huayi.production；新加坡区域；备份保留 30 天。",
    ].join("\n"),
  );
  await write(
    root,
    "docs/cloud-v1/store-listing.md",
    [
      "# Huayi Cloud listing",
      "alarms storage unlimitedStorage",
      "api.openai.com api.deepseek.com api.frdic.com api.huayi.production",
      apiOrigin,
      webOrigin,
      privacyUrl,
      "Huayi API 账号与服务器可读 Cloud 学习内容；BYOK 凭据只在本机。",
    ].join("\n"),
  );
  return root;
}

export async function withFixture(run) {
  const root = await createFixture();
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
