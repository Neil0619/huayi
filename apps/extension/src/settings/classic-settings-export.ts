import { parseStoredSettings, type ExtensionSettings } from "./settings-domain.js";

export function serializeClassicSettingsTransfer(settings: ExtensionSettings): string {
  const parsed = parseStoredSettings(settings);
  if (parsed.status !== "valid") throw new TypeError("Cannot export invalid Classic settings.");
  const rules = [...parsed.settings.sitePolicy.rules].sort((left, right) =>
    left.hostname.localeCompare(right.hostname),
  );
  return JSON.stringify(
    {
      format: "huayi-classic-settings",
      formatVersion: 1,
      settings: {
        defaultAction: parsed.settings.defaultAction,
        enabled: parsed.settings.enabled,
        sitePolicy: { ...parsed.settings.sitePolicy, rules },
        youtube: parsed.settings.youtube,
      },
    },
    null,
    2,
  );
}
