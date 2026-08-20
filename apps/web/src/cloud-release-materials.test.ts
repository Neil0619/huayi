// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const listing = readFileSync("docs/cloud-v1/store-listing.md", "utf8");
const privacy = readFileSync("docs/cloud-v1/privacy-policy.md", "utf8");
const manifest = JSON.parse(readFileSync("apps/store-extension/manifest.json", "utf8")) as Record<
  string,
  unknown
>;

describe("Cloud release trust materials", () => {
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
    expect(listing).toContain("Huayi API");
    expect(listing).toContain("Cloud 内容端到端加密");
    expect(listing).toContain("不得宣称");
    expect(listing).toContain("华译服务端不接收");
    expect(privacy).toContain("Cloud V1 不是端到端加密产品");
    expect(privacy.replaceAll(/\s+/gu, " ")).toContain("Chrome Web Store User Data Policy");
  });
});
