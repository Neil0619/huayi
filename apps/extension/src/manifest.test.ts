import { describe, expect, it } from "vitest";

import manifest from "../manifest.json" with { type: "json" };

describe("extension manifest", () => {
  it("uses Manifest V3 with the bounded settings and active-tab permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["activeTab", "alarms", "nativeMessaging", "storage"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest.action).toEqual({ default_popup: "popup.html", default_title: "划译" });
    expect(manifest.options_page).toBe("options.html");
  });

  it("injects the isolated script into normal HTTP and HTTPS pages", () => {
    expect(manifest.content_scripts).toHaveLength(2);
    expect(manifest.content_scripts[0]?.matches).toEqual(["http://*/*", "https://*/*"]);
    expect(manifest.content_scripts[0]?.all_frames).toBe(false);
  });

  it("injects the YouTube bridge in the MAIN world at document start", () => {
    expect(manifest.content_scripts[1]).toEqual({
      matches: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
      js: ["youtube-bridge.js"],
      run_at: "document_start",
      world: "MAIN",
      all_frames: false,
    });
  });

  it("declares the module service worker and static content bundle", () => {
    expect(manifest.background).toEqual({
      service_worker: "service-worker.js",
      type: "module",
    });
    expect(manifest.content_scripts[0]?.js).toEqual(["content-script.js"]);
  });
});
