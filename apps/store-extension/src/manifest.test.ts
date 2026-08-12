import { describe, expect, it } from "vitest";

import manifest from "../manifest.json" with { type: "json" };

describe("Store extension manifest", () => {
  it("uses the reviewed MV3 permissions and exact external hosts", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["alarms", "storage", "unlimitedStorage"]);
    expect(manifest.host_permissions).toEqual([
      "https://api.openai.com/*",
      "https://api.deepseek.com/*",
      "https://api.frdic.com/*",
    ]);
    expect(manifest.incognito).toBe("not_allowed");
    expect(manifest.action).toEqual({ default_popup: "popup.html" });
    expect(manifest.options_ui).toEqual({ open_in_tab: true, page: "options.html" });
    expect(manifest.web_accessible_resources).toEqual([
      { matches: ["http://*/*", "https://*/*"], resources: ["overlay.css"] },
    ]);
    expect(manifest.content_scripts[0]?.matches).toEqual(["http://*/*", "https://*/*"]);
    expect(manifest.content_scripts[1]).toEqual({
      all_frames: false,
      js: ["youtube-content.js"],
      matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
      run_at: "document_idle",
    });
    expect(manifest.content_scripts[2]).toEqual({
      all_frames: false,
      js: ["youtube-main.js"],
      matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
      run_at: "document_start",
      world: "MAIN",
    });
  });

  it("does not request Native Messaging, activeTab, or remote code", () => {
    expect(manifest.permissions).not.toContain("nativeMessaging");
    expect(manifest.permissions).not.toContain("activeTab");
    expect(manifest.permissions).not.toContain("scripting");
    expect(manifest.permissions).not.toContain("tabs");
    expect(JSON.stringify(manifest)).not.toContain("@huayi/protocol");
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self'; connect-src https://api.openai.com https://api.deepseek.com https://api.frdic.com",
    );
  });
});
