import { describe, expect, it } from "vitest";

import manifest from "../manifest.json" with { type: "json" };

describe("extension manifest", () => {
  it("uses Manifest V3 with only nativeMessaging permission", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["nativeMessaging"]);
    expect(manifest).not.toHaveProperty("host_permissions");
  });

  it("injects only into normal HTTP and HTTPS pages", () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0]?.matches).toEqual(["http://*/*", "https://*/*"]);
    expect(manifest.content_scripts[0]?.all_frames).toBe(false);
  });

  it("declares the module service worker and static content bundle", () => {
    expect(manifest.background).toEqual({
      service_worker: "service-worker.js",
      type: "module",
    });
    expect(manifest.content_scripts[0]?.js).toEqual(["content-script.js"]);
  });
});
