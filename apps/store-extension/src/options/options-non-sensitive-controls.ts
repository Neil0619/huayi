import {
  type ProviderId,
  type StoreDefaultAction,
  type StoreKeyboardShortcut,
  type StoreSettings,
  type StoreSettingsRepository,
  type YouTubeMode,
} from "@huayi/store-domain";

interface OptionsNonSensitiveControlsDependencies {
  readonly execute: (operation: () => Promise<void>, success: string) => void;
  readonly notifySitePolicyChanged: () => Promise<void>;
  readonly refreshSettings: () => Promise<void>;
  readonly settings: StoreSettingsRepository;
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing Store settings element: ${selector}`);
  return found;
}

function shortcutFromEvent(event: KeyboardEvent): StoreKeyboardShortcut | null {
  if (!/^(?:Key[A-Z]|Digit\d|F(?:[1-9]|1\d|2[0-4]))$/u.test(event.code)) return null;
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) return null;
  return {
    alt: event.altKey,
    code: event.code,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

function shortcutLabel(shortcut: StoreKeyboardShortcut | null): string {
  if (shortcut === null) return "已关闭";
  const key = shortcut.code.startsWith("Key") ? shortcut.code.slice(3) : shortcut.code;
  return [
    shortcut.ctrl ? "Ctrl" : "",
    shortcut.alt ? "Alt" : "",
    shortcut.shift ? "Shift" : "",
    shortcut.meta ? "⌘" : "",
    key,
  ]
    .filter((part) => part.length > 0)
    .join(" + ");
}

export class OptionsNonSensitiveControls {
  constructor(private readonly dependencies: OptionsNonSensitiveControlsDependencies) {}

  bind(): void {
    this.bindGlobalToggle();
    this.bindSelects();
    this.bindShortcut();
  }

  render(settings: StoreSettings | null, busy: boolean): void {
    element<HTMLInputElement>("[data-global-enabled]").checked = settings?.globallyEnabled ?? true;
    element<HTMLSelectElement>("[data-provider]").value = settings?.providerId ?? "openai";
    element<HTMLSelectElement>("[data-default-action]").value = settings?.defaultAction ?? "ask";
    element<HTMLSelectElement>("[data-youtube-mode]").value = settings?.youtubeMode ?? "english";
    element<HTMLButtonElement>("[data-youtube-shortcut]").textContent = shortcutLabel(
      settings?.youtubeShortcut ?? null,
    );
    this.renderExactBlockedHosts(settings, busy);
  }

  private bindGlobalToggle(): void {
    element<HTMLInputElement>("[data-global-enabled]").addEventListener("change", (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      this.dependencies.execute(
        async () => {
          await this.dependencies.settings.setGloballyEnabled(enabled);
          await this.refreshSitePolicy();
        },
        enabled ? "划译全局开关已启用。" : "划译已在所有网站停用。",
      );
    });
  }

  private bindSelects(): void {
    element<HTMLSelectElement>("[data-provider]").addEventListener("change", (event) => {
      const provider = (event.currentTarget as HTMLSelectElement).value as ProviderId;
      this.dependencies.execute(async () => {
        await this.dependencies.settings.setProvider(provider);
        await this.dependencies.refreshSettings();
      }, "模型服务已更新。新的分析请求将使用该服务。");
    });
    element<HTMLSelectElement>("[data-default-action]").addEventListener("change", (event) => {
      const action = (event.currentTarget as HTMLSelectElement).value as StoreDefaultAction;
      this.dependencies.execute(async () => {
        await this.dependencies.settings.setDefaultAction(action);
        await this.refreshSitePolicy();
      }, "划词后的默认动作已更新。");
    });
    element<HTMLSelectElement>("[data-youtube-mode]").addEventListener("change", (event) => {
      const mode = (event.currentTarget as HTMLSelectElement).value as YouTubeMode;
      this.dependencies.execute(async () => {
        await this.dependencies.settings.setYoutubeMode(mode);
        await this.dependencies.refreshSettings();
      }, "YouTube 字幕偏好已更新；已打开的视频页需刷新后生效。");
    });
  }

  private bindShortcut(): void {
    const button = element<HTMLButtonElement>("[data-youtube-shortcut]");
    button.addEventListener("click", () => {
      button.dataset.recording = "true";
      button.textContent = "请按新的组合键…";
      button.focus();
    });
    button.addEventListener("keydown", (event) => {
      if (button.dataset.recording !== "true") return;
      event.preventDefault();
      event.stopPropagation();
      const shortcut = shortcutFromEvent(event);
      if (shortcut === null) return;
      delete button.dataset.recording;
      this.dependencies.execute(async () => {
        await this.dependencies.settings.setYoutubeShortcut(shortcut);
        await this.dependencies.refreshSettings();
      }, "YouTube 临时双语快捷键已更新。");
    });
    element<HTMLButtonElement>("[data-youtube-shortcut-clear]").addEventListener("click", () => {
      this.dependencies.execute(async () => {
        await this.dependencies.settings.setYoutubeShortcut(null);
        await this.dependencies.refreshSettings();
      }, "YouTube 临时双语快捷键已关闭。");
    });
  }

  private async refreshSitePolicy(): Promise<void> {
    await this.dependencies.refreshSettings();
    await this.dependencies.notifySitePolicyChanged();
  }

  private renderExactBlockedHosts(settings: StoreSettings | null, busy: boolean): void {
    const list = element<HTMLUListElement>("[data-disabled-hosts]");
    list.replaceChildren();
    const hosts =
      settings?.sitePolicy.rules
        .filter((rule) => rule.action === "block" && !rule.includeSubdomains)
        .map((rule) => rule.hostname) ?? [];
    if (hosts.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "没有单独停用的网站。";
      list.append(empty);
      return;
    }
    for (const host of hosts) list.append(this.hostItem(host, busy));
  }

  private hostItem(host: string, busy: boolean): HTMLLIElement {
    const item = document.createElement("li");
    const label = document.createElement("code");
    label.textContent = host;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "重新启用";
    button.dataset.enableHost = host;
    button.disabled = busy;
    button.addEventListener("click", () => {
      this.dependencies.execute(async () => {
        await this.dependencies.settings.setSiteEnabled(host, true);
        await this.refreshSitePolicy();
      }, `已在 ${host} 重新启用划译。`);
    });
    item.append(label, button);
    return item;
  }
}
