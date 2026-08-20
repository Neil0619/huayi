import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

import { PrivacyPage } from "./privacy-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Public privacy page", () => {
  beforeEach(() => document.body.replaceChildren());

  it("renders the pre-release data, recipient, retention, and control boundaries", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => createRoot(container).render(<PrivacyPage />));

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("华译 Cloud V1 隐私说明");
    expect(container.textContent).toContain("预发布");
    expect(container.textContent).toContain("主动选择的英文与必要上下文");
    expect(container.textContent).toContain("华译服务器能够读取");
    expect(container.textContent).toContain("DeepSeek");
    expect(container.textContent).toContain("Supabase");
    expect(container.textContent).toContain("BYOK 与欧路凭据只保存在本机");
    expect(container.textContent).toContain("最多 20 条、5 MiB、7 天");
    expect(container.textContent).toContain("24 小时内删除");
    expect(container.textContent).toContain("运营主体、联系方式、实际部署区域和备份残留期限");
    expect(container.textContent).toContain("未成年人适用规则、适用法律和争议处理方式");
    expect(container.textContent).toContain(
      "The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy",
    );
  });

  it("uses only structured text and safe same-tab policy links", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => createRoot(container).render(<PrivacyPage />));

    expect(container.querySelector("script, iframe, img")).toBeNull();
    const externalLinks = [...container.querySelectorAll<HTMLAnchorElement>("a[data-external]")];
    expect(externalLinks).toHaveLength(3);
    for (const link of externalLinks) {
      expect(link.protocol).toBe("https:");
      expect(link.hostname).toBe("developer.chrome.com");
      expect(link.target).toBe("");
      expect(link.rel).toContain("noreferrer");
    }
    expect(container.querySelector<HTMLAnchorElement>("a.skip-link")?.hash).toBe(
      "#privacy-content",
    );
  });
});
