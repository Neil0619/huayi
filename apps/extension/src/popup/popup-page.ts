import type { ModelProvider } from "@huayi/protocol";

import {
  DEFAULT_EXTENSION_SETTINGS,
  evaluatePageAccess,
  normalizeSiteRuleInput,
  type ExtensionSettings,
} from "../settings/settings-domain.js";
import { SettingsHostClient } from "../settings/settings-host-client.js";
import { settingsMutationsBetween } from "../settings/settings-mutations.js";
import { SettingsStore } from "../settings/settings-store.js";

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  codex: "Codex",
  "deepseek-chat-completions": "DeepSeek",
  "openai-compatible-http": "Compatible HTTP",
  "openai-responses": "OpenAI",
};

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing popup element: ${selector}`);
  return found;
}

function message(value: string, error = false): void {
  const output = element<HTMLElement>("[data-popup-message]");
  output.textContent = value;
  output.dataset.error = String(error);
}

async function activeHttpUrl(): Promise<URL | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url === undefined) return null;
  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export class PopupPage {
  private settings: ExtensionSettings = DEFAULT_EXTENSION_SETTINGS;
  private url: URL | null = null;

  constructor(
    private readonly store = new SettingsStore(),
    private readonly host = new SettingsHostClient(),
  ) {}

  async initialize(): Promise<void> {
    const [parsed, url] = await Promise.all([this.store.read(), activeHttpUrl()]);
    this.settings = parsed.settings;
    this.url = url;
    this.bind();
    this.render();
    if (parsed.status === "invalid") message("配置损坏，语见已安全停用。", true);
    await this.renderHostStatus();
  }

  private bind(): void {
    element<HTMLInputElement>("[data-popup-enabled]").addEventListener("change", (event) => {
      void this.save({
        ...this.settings,
        enabled: (event.currentTarget as HTMLInputElement).checked,
      });
    });
    element<HTMLInputElement>("[data-popup-site-enabled]").addEventListener("change", (event) => {
      if (this.url === null) return;
      const hostname = normalizeSiteRuleInput(this.url.hostname);
      const action = (event.currentTarget as HTMLInputElement).checked ? "allow" : "block";
      const rules = this.settings.sitePolicy.rules.filter((rule) => rule.hostname !== hostname);
      const inherited = evaluatePageAccess(this.url, {
        ...this.settings,
        enabled: true,
        sitePolicy: { ...this.settings.sitePolicy, rules },
      });
      if (inherited !== action) rules.push({ action, hostname, includeSubdomains: false });
      void this.save({
        ...this.settings,
        sitePolicy: { ...this.settings.sitePolicy, rules },
      });
    });
    element<HTMLButtonElement>("[data-popup-sync]").addEventListener("click", () => {
      void this.host.startWordSync().then(
        () => message("已开始准备同步。"),
        (error: unknown) => message(error instanceof Error ? error.message : "同步失败。", true),
      );
    });
    element<HTMLButtonElement>("[data-popup-options]").addEventListener("click", () => {
      void chrome.runtime.openOptionsPage();
    });
  }

  private async save(settings: ExtensionSettings): Promise<void> {
    try {
      let current = this.settings;
      for (const mutation of settingsMutationsBetween(this.settings, settings)) {
        current = await this.host.mutateSettings(mutation);
      }
      this.settings = current;
      this.render();
      message("设置已保存");
    } catch {
      message("设置保存失败。", true);
    }
  }

  private render(): void {
    element<HTMLInputElement>("[data-popup-enabled]").checked = this.settings.enabled;
    const host = element<HTMLElement>("[data-popup-host]");
    const toggle = element<HTMLInputElement>("[data-popup-site-enabled]");
    const note = element<HTMLElement>("[data-popup-site-note]");
    if (this.url === null) {
      host.textContent = "此页面不支持语见";
      toggle.disabled = true;
      toggle.checked = false;
      note.textContent = "仅支持普通 HTTP(S) 页面";
    } else {
      host.textContent = this.url.hostname;
      toggle.disabled = false;
      toggle.checked =
        evaluatePageAccess(this.url, { ...this.settings, enabled: true }) === "allow";
      const exact = this.settings.sitePolicy.rules.find(
        (rule) => rule.hostname === this.url?.hostname,
      );
      toggle.disabled = exact?.includeSubdomains === true;
      note.textContent =
        exact?.includeSubdomains === true
          ? "此规则包含子域，请在完整设置中修改"
          : exact === undefined
            ? "继承网站默认策略"
            : "使用当前网站的精确规则";
    }
    element<HTMLButtonElement>("[data-popup-sync]").disabled = !this.settings.wordbook.enabled;
  }

  private async renderHostStatus(): Promise<void> {
    try {
      const status = await this.host.status();
      element<HTMLElement>("[data-popup-provider]").textContent =
        PROVIDER_LABELS[status.currentProvider];
      element<HTMLElement>("[data-popup-wordbook]").textContent = status.wordbookConfigured
        ? this.settings.wordbook.enabled
          ? "已连接"
          : "已停用"
        : "未配置";
    } catch (error) {
      element<HTMLElement>("[data-popup-provider]").textContent = "Host 不可用";
      element<HTMLElement>("[data-popup-wordbook]").textContent = "状态未知";
      message(error instanceof Error ? error.message : "无法连接本机服务。", true);
    }
  }
}

if (typeof chrome !== "undefined") {
  void new PopupPage().initialize().catch((error: unknown) => {
    message(error instanceof Error ? error.message : "工具栏初始化失败。", true);
  });
}
