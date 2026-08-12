import { describe, expect, it } from "vitest";

import { DEFAULT_EXTENSION_SETTINGS } from "./settings-domain.js";
import { serializeClassicSettingsTransfer } from "./classic-settings-export.js";

describe("Classic settings transfer export", () => {
  it("exports only the strict migration contract and sorts normalized site rules", () => {
    const serialized = serializeClassicSettingsTransfer({
      ...DEFAULT_EXTENSION_SETTINGS,
      defaultAction: "explain",
      enabled: false,
      sitePolicy: {
        defaultAction: "block",
        rules: [
          { action: "allow", hostname: "z.example", includeSubdomains: true },
          { action: "block", hostname: "a.example", includeSubdomains: false },
        ],
      },
      wordbook: { automaticSync: true, enabled: true, syncHour: 23 },
      youtube: {
        defaultBilingual: true,
        enabled: true,
        shortcut: { alt: false, code: "KeyK", ctrl: true, meta: false, shift: false },
      },
    });

    expect(JSON.parse(serialized)).toEqual({
      format: "huayi-classic-settings",
      formatVersion: 1,
      settings: {
        defaultAction: "explain",
        enabled: false,
        sitePolicy: {
          defaultAction: "block",
          rules: [
            { action: "block", hostname: "a.example", includeSubdomains: false },
            { action: "allow", hostname: "z.example", includeSubdomains: true },
          ],
        },
        youtube: {
          defaultBilingual: true,
          enabled: true,
          shortcut: { alt: false, code: "KeyK", ctrl: true, meta: false, shift: false },
        },
      },
    });
    expect(serialized).not.toMatch(
      /api.?key|authorization|provider|automaticSync|syncHour|extension.?id|url|title|page|model/iu,
    );
  });
});
