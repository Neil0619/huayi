// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const listing = readFileSync("docs/cloud-v1/store-listing.md", "utf8");
const privacy = readFileSync("docs/cloud-v1/privacy-policy.md", "utf8");
const privacyPage = readFileSync("apps/web/src/privacy-page.tsx", "utf8");
const webPackage = JSON.parse(readFileSync("apps/web/package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const webVercel = JSON.parse(readFileSync("apps/web/vercel.json", "utf8")) as Record<
  string,
  unknown
>;
const manifest = JSON.parse(readFileSync("apps/store-extension/manifest.json", "utf8")) as Record<
  string,
  unknown
>;

describe("Cloud release trust materials", () => {
  it("pins the hosted Web build and SPA output contract", () => {
    expect(webVercel.framework).toBe("vite");
    expect(webVercel.buildCommand).toBe("pnpm build:vercel");
    expect(webPackage.scripts?.["build:vercel"]).toBe(
      "pnpm --dir ../.. --filter @huayi/learning-domain --filter @huayi/cloud-contracts build && pnpm build",
    );
    expect(webVercel.outputDirectory).toBe("dist");
    expect(webVercel.rewrites).toEqual([{ destination: "/index.html", source: "/(.*)" }]);
    expect(webVercel.git).toEqual({
      deploymentEnabled: {
        "**": false,
        "codex/settings-configuration": true,
      },
    });
  });

  it("keeps the Store single purpose on English understanding and the learning loop", () => {
    const normalized = listing.replaceAll(/\s+/gu, " ");
    expect(normalized).toContain("理解当前阅读或观看语境中主动选择的英文");
    expect(normalized).toContain("分析、整理、学习与练习闭环");
    expect(normalized).toContain("不下载或执行远程扩展代码");
    expect(normalized).not.toContain("Web 是远程代码宿主");
  });

  it("covers every current Manifest permission and third-party host", () => {
    for (const permission of manifest.permissions as string[])
      expect(listing).toContain(permission);
    for (const host of manifest.host_permissions as string[]) {
      expect(listing).toContain(new URL(host.replace("/*", "")).hostname.split(".")[1]);
    }
    expect(listing).toContain("生产 origin 未固定");
    expect(listing).toContain("正式候选包权限一致性");
  });

  it("does not reuse the local-only Store product claim for Cloud", () => {
    expect(listing).toContain("语见 API");
    expect(listing).toContain("Cloud 内容端到端加密");
    expect(listing).toContain("不得宣称");
    expect(listing).toContain("语见服务端不接收");
    expect(privacy).toContain("Cloud V1 不是端到端加密产品");
    expect(privacy.replaceAll(/\s+/gu, " ")).toContain("Chrome Web Store User Data Policy");
  });

  it("keeps BYOK, platform query, StudyCapture, and CloudWordCopy disclosures distinct", () => {
    for (const material of [listing, privacy, privacyPage]) {
      expect(material).toContain("BYOK");
      expect(material).toContain("StudyCapture");
      expect(material).toContain("CloudWordCopy");
      expect(material).not.toContain("登录 BYOK 上传");
      expect(material).not.toContain("严格结果才可上传 Huayi");
    }
    expect(privacyPage).toContain("BYOK Key 与该次精简结果不会发送给语见");
    expect(privacyPage).toContain("最多保留一小时");
    expect(privacyPage).toContain("不进入待整理或分析历史");
  });
});
