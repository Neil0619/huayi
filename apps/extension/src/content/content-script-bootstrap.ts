import { evaluatePageAccess, type ExtensionSettings } from "../settings/settings-domain.js";
import type { SettingsStore } from "../settings/settings-store.js";

export interface ContentScriptBootstrap {
  destroy(): void;
}

interface SettingsDrivenInstance {
  destroy(): void;
  updateSettings(settings: ExtensionSettings): void;
}

export async function bootstrapSettingsDrivenContent(
  store: SettingsStore,
  initialize: (settings: ExtensionSettings) => SettingsDrivenInstance,
): Promise<ContentScriptBootstrap> {
  let instance: SettingsDrivenInstance | null = null;
  let destroyed = false;
  let fingerprint = "";
  const runtimeFingerprint = (settings: ExtensionSettings): string =>
    JSON.stringify({
      access: evaluatePageAccess(new URL(location.href), settings),
      wordbookEnabled: settings.wordbook.enabled,
      youtube: settings.youtube,
    });
  const start = (settings: ExtensionSettings): void => {
    const nextFingerprint = runtimeFingerprint(settings);
    if (instance !== null && fingerprint === nextFingerprint) {
      instance.updateSettings(settings);
      return;
    }
    instance?.destroy();
    fingerprint = nextFingerprint;
    if (!destroyed) instance = initialize(settings);
  };
  let revision = 0;
  const unsubscribe = store.subscribe((next) => {
    revision += 1;
    start(next.settings);
  });
  const initialRevision = revision;
  try {
    const parsed = await store.read();
    if (revision === initialRevision) start(parsed.settings);
  } catch {
    // Leave the content script uninitialized until a valid storage change arrives.
  }
  return {
    destroy: () => {
      destroyed = true;
      unsubscribe();
      instance?.destroy();
      instance = null;
    },
  };
}
