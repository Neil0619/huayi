import type { ExtensionSettings, SettingsMutation } from "../settings/settings-domain.js";
import { applySettingsMutation } from "../settings/settings-mutations.js";
import { SettingsStore } from "../settings/settings-store.js";

export class SettingsMutationError extends Error {
  constructor() {
    super("配置已损坏，请先恢复默认设置。");
    this.name = "SettingsMutationError";
  }
}

export class SettingsCoordinator {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly store = new SettingsStore()) {}

  mutate(mutation: SettingsMutation): Promise<ExtensionSettings> {
    let resolveResult: (settings: ExtensionSettings) => void = () => undefined;
    let rejectResult: (error: unknown) => void = () => undefined;
    const result = new Promise<ExtensionSettings>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        const parsed = await this.store.read();
        if (parsed.status === "invalid" && mutation.type !== "reset") {
          throw new SettingsMutationError();
        }
        const next = applySettingsMutation(parsed.settings, mutation);
        await this.store.replace(next);
        resolveResult(next);
      })
      .catch((error: unknown) => {
        rejectResult(error);
      });
    return result;
  }
}
