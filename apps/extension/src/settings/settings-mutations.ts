import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_YOUTUBE_SHORTCUT,
  type ExtensionSettings,
  type SettingsMutation,
} from "./settings-domain.js";

export function applySettingsMutation(
  settings: ExtensionSettings,
  mutation: SettingsMutation,
): ExtensionSettings {
  switch (mutation.type) {
    case "set-enabled":
      return { ...settings, enabled: mutation.enabled };
    case "set-default-action":
      return { ...settings, defaultAction: mutation.action };
    case "set-site-default":
      return {
        ...settings,
        sitePolicy: { ...settings.sitePolicy, defaultAction: mutation.action },
      };
    case "upsert-site-rule":
      return {
        ...settings,
        sitePolicy: {
          ...settings.sitePolicy,
          rules: [
            ...settings.sitePolicy.rules.filter(
              (candidate) => candidate.hostname !== mutation.rule.hostname,
            ),
            mutation.rule,
          ],
        },
      };
    case "remove-site-rule":
      return {
        ...settings,
        sitePolicy: {
          ...settings.sitePolicy,
          rules: settings.sitePolicy.rules.filter(
            (candidate) => candidate.hostname !== mutation.hostname,
          ),
        },
      };
    case "set-wordbook":
      return { ...settings, wordbook: { ...settings.wordbook, ...mutation.values } };
    case "set-youtube":
      return { ...settings, youtube: { ...settings.youtube, ...mutation.values } };
    case "reset":
      return {
        ...DEFAULT_EXTENSION_SETTINGS,
        sitePolicy: { ...DEFAULT_EXTENSION_SETTINGS.sitePolicy, rules: [] },
        wordbook: { ...DEFAULT_EXTENSION_SETTINGS.wordbook },
        youtube: {
          ...DEFAULT_EXTENSION_SETTINGS.youtube,
          shortcut: { ...DEFAULT_YOUTUBE_SHORTCUT },
        },
      };
  }
}

export function settingsMutationsBetween(
  previous: ExtensionSettings,
  next: ExtensionSettings,
): SettingsMutation[] {
  const mutations: SettingsMutation[] = [];
  if (previous.enabled !== next.enabled) {
    mutations.push({ enabled: next.enabled, type: "set-enabled" });
  }
  if (previous.defaultAction !== next.defaultAction) {
    mutations.push({ action: next.defaultAction, type: "set-default-action" });
  }
  if (previous.sitePolicy.defaultAction !== next.sitePolicy.defaultAction) {
    mutations.push({ action: next.sitePolicy.defaultAction, type: "set-site-default" });
  }
  for (const rule of previous.sitePolicy.rules) {
    if (!next.sitePolicy.rules.some((candidate) => candidate.hostname === rule.hostname)) {
      mutations.push({ hostname: rule.hostname, type: "remove-site-rule" });
    }
  }
  for (const rule of next.sitePolicy.rules) {
    const current = previous.sitePolicy.rules.find(
      (candidate) => candidate.hostname === rule.hostname,
    );
    if (
      current === undefined ||
      current.action !== rule.action ||
      current.includeSubdomains !== rule.includeSubdomains
    ) {
      mutations.push({ rule, type: "upsert-site-rule" });
    }
  }
  const wordbookValues: Partial<ExtensionSettings["wordbook"]> = {};
  if (previous.wordbook.automaticSync !== next.wordbook.automaticSync) {
    wordbookValues.automaticSync = next.wordbook.automaticSync;
  }
  if (previous.wordbook.enabled !== next.wordbook.enabled) {
    wordbookValues.enabled = next.wordbook.enabled;
  }
  if (previous.wordbook.syncHour !== next.wordbook.syncHour) {
    wordbookValues.syncHour = next.wordbook.syncHour;
  }
  if (Object.keys(wordbookValues).length > 0) {
    mutations.push({ type: "set-wordbook", values: wordbookValues });
  }
  const youtubeValues: Partial<ExtensionSettings["youtube"]> = {};
  if (previous.youtube.enabled !== next.youtube.enabled) {
    youtubeValues.enabled = next.youtube.enabled;
  }
  if (previous.youtube.defaultBilingual !== next.youtube.defaultBilingual) {
    youtubeValues.defaultBilingual = next.youtube.defaultBilingual;
  }
  if (JSON.stringify(previous.youtube.shortcut) !== JSON.stringify(next.youtube.shortcut)) {
    youtubeValues.shortcut = next.youtube.shortcut;
  }
  if (Object.keys(youtubeValues).length > 0) {
    mutations.push({ type: "set-youtube", values: youtubeValues });
  }
  return mutations;
}
