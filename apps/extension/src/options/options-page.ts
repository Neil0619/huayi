import type { ModelProvider, SettingsStatusResultEvent } from "@huayi/protocol";

import {
  DEFAULT_EXTENSION_SETTINGS,
  normalizeSiteRuleInput,
  type ExtensionSettings,
  type KeyboardShortcut,
  type SiteAction,
} from "../settings/settings-domain.js";
import { SettingsHostClient } from "../settings/settings-host-client.js";
import { settingsMutationsBetween } from "../settings/settings-mutations.js";
import { SettingsStore } from "../settings/settings-store.js";

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  codex: "Codex",
  "deepseek-chat-completions": "DeepSeek",
  "openai-compatible-http": "OpenAI-compatible HTTP",
  "openai-responses": "OpenAI",
};

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing settings element: ${selector}`);
  return found;
}

function setStatus(message: string, tone: "error" | "neutral" | "success" = "neutral"): void {
  const status = element<HTMLElement>("[data-settings-status]");
  status.textContent = message;
  status.dataset.tone = tone;
}

function shortcutLabel(shortcut: KeyboardShortcut | null): string {
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

function keyboardShortcut(event: KeyboardEvent): KeyboardShortcut | null {
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

export class OptionsPage {
  private settings = DEFAULT_EXTENSION_SETTINGS;

  constructor(
    private readonly store = new SettingsStore(),
    private readonly host = new SettingsHostClient(),
  ) {}

  async initialize(): Promise<void> {
    const parsed = await this.store.read();
    this.settings = parsed.settings;
    this.bindNavigation();
    this.bindGeneral();
    this.bindSites();
    this.bindWordbook();
    this.bindYouTube();
    const hourSelect = element<HTMLSelectElement>("[data-wordbook-hour]");
    for (let hour = 0; hour < 24; hour += 1) {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = `${String(hour).padStart(2, "0")}:00`;
      hourSelect.append(option);
    }
    this.render();
    if (parsed.status === "invalid") {
      setStatus("配置已损坏，功能已安全停用。请恢复默认设置。", "error");
      element<HTMLButtonElement>("[data-reset-settings]").hidden = false;
    }
    await this.refreshHostStatus();
  }

  private bindNavigation(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-nav-target]")) {
      button.addEventListener("click", () => {
        const target = button.dataset.navTarget;
        for (const item of document.querySelectorAll<HTMLElement>("[data-nav-target]")) {
          item.dataset.active = String(item === button);
        }
        for (const section of document.querySelectorAll<HTMLElement>("[data-settings-section]")) {
          section.hidden = section.dataset.settingsSection !== target;
        }
        history.replaceState(null, "", `#${target ?? "general"}`);
      });
    }
    const initial = location.hash.slice(1) || "general";
    document.querySelector<HTMLButtonElement>(`[data-nav-target='${initial}']`)?.click();
    element<HTMLButtonElement>("[data-reset-settings]").addEventListener("click", () => {
      void this.host.mutateSettings({ type: "reset" }).then(() => location.reload());
    });
  }

  private bindGeneral(): void {
    element<HTMLInputElement>("[data-setting-enabled]").addEventListener("change", (event) => {
      void this.save({
        ...this.settings,
        enabled: (event.currentTarget as HTMLInputElement).checked,
      });
    });
    for (const control of document.querySelectorAll<HTMLInputElement>("[name='default-action']")) {
      control.addEventListener("change", () => {
        if (control.checked)
          void this.save({
            ...this.settings,
            defaultAction: control.value as ExtensionSettings["defaultAction"],
          });
      });
    }
  }

  private bindSites(): void {
    for (const control of document.querySelectorAll<HTMLInputElement>("[name='site-default']")) {
      control.addEventListener("change", () => {
        if (!control.checked) return;
        void this.save({
          ...this.settings,
          sitePolicy: { ...this.settings.sitePolicy, defaultAction: control.value as SiteAction },
        });
      });
    }
    element<HTMLFormElement>("[data-site-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = element<HTMLInputElement>("[data-site-input]");
      try {
        const hostname = normalizeSiteRuleInput(input.value);
        if (this.settings.sitePolicy.rules.some((rule) => rule.hostname === hostname)) {
          throw new Error("这个网站已经存在规则。");
        }
        const action = element<HTMLSelectElement>("[data-site-action]").value as SiteAction;
        const includeSubdomains = element<HTMLInputElement>("[data-site-subdomains]").checked;
        void this.save({
          ...this.settings,
          sitePolicy: {
            ...this.settings.sitePolicy,
            rules: [...this.settings.sitePolicy.rules, { action, hostname, includeSubdomains }],
          },
        }).then(() => {
          input.value = "";
          this.renderSiteRules();
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "网站规则无效。", "error");
      }
    });
  }

  private bindWordbook(): void {
    element<HTMLInputElement>("[data-wordbook-enabled]").addEventListener("change", (event) => {
      void this.save({
        ...this.settings,
        wordbook: {
          ...this.settings.wordbook,
          enabled: (event.currentTarget as HTMLInputElement).checked,
        },
      }).then(() => this.render());
    });
    element<HTMLInputElement>("[data-wordbook-auto]").addEventListener("change", (event) => {
      void this.save({
        ...this.settings,
        wordbook: {
          ...this.settings.wordbook,
          automaticSync: (event.currentTarget as HTMLInputElement).checked,
        },
      });
    });
    element<HTMLSelectElement>("[data-wordbook-hour]").addEventListener("change", (event) => {
      void this.save({
        ...this.settings,
        wordbook: {
          ...this.settings.wordbook,
          syncHour: Number((event.currentTarget as HTMLSelectElement).value),
        },
      });
    });
    element<HTMLButtonElement>("[data-manual-sync]").addEventListener("click", () => {
      void this.host.startWordSync().then(
        () => setStatus("已开始准备生词同步。", "success"),
        (error: unknown) =>
          setStatus(error instanceof Error ? error.message : "同步启动失败。", "error"),
      );
    });
  }

  private bindYouTube(): void {
    for (const key of ["enabled", "defaultBilingual"] as const) {
      element<HTMLInputElement>(`[data-youtube-${key}]`).addEventListener("change", (event) => {
        void this.save({
          ...this.settings,
          youtube: {
            ...this.settings.youtube,
            [key]: (event.currentTarget as HTMLInputElement).checked,
          },
        }).then(() => this.render());
      });
    }
    const shortcut = element<HTMLButtonElement>("[data-youtube-shortcut]");
    shortcut.addEventListener("click", () => {
      shortcut.dataset.recording = "true";
      shortcut.textContent = "请按新的组合键…";
      shortcut.focus();
    });
    shortcut.addEventListener("keydown", (event) => {
      if (shortcut.dataset.recording !== "true") return;
      event.preventDefault();
      event.stopPropagation();
      const value = keyboardShortcut(event);
      if (value === null) {
        setStatus("快捷键需要修饰键，并使用字母、数字或 F1–F24。", "error");
        return;
      }
      delete shortcut.dataset.recording;
      void this.save({
        ...this.settings,
        youtube: { ...this.settings.youtube, shortcut: value },
      }).then(() => this.render());
    });
    element<HTMLButtonElement>("[data-youtube-shortcut-clear]").addEventListener("click", () => {
      void this.save({
        ...this.settings,
        youtube: { ...this.settings.youtube, shortcut: null },
      }).then(() => this.render());
    });
  }

  private async save(settings: ExtensionSettings): Promise<void> {
    let current = this.settings;
    for (const mutation of settingsMutationsBetween(this.settings, settings)) {
      current = await this.host.mutateSettings(mutation);
    }
    this.settings = current;
    setStatus("设置已保存", "success");
  }

  private render(): void {
    element<HTMLInputElement>("[data-setting-enabled]").checked = this.settings.enabled;
    element<HTMLInputElement>(
      `[name='default-action'][value='${this.settings.defaultAction}']`,
    ).checked = true;
    element<HTMLInputElement>(
      `[name='site-default'][value='${this.settings.sitePolicy.defaultAction}']`,
    ).checked = true;
    element<HTMLInputElement>("[data-wordbook-enabled]").checked = this.settings.wordbook.enabled;
    element<HTMLInputElement>("[data-wordbook-auto]").checked =
      this.settings.wordbook.automaticSync;
    element<HTMLInputElement>("[data-wordbook-auto]").disabled = !this.settings.wordbook.enabled;
    element<HTMLSelectElement>("[data-wordbook-hour]").value = String(
      this.settings.wordbook.syncHour,
    );
    element<HTMLSelectElement>("[data-wordbook-hour]").disabled =
      !this.settings.wordbook.enabled || !this.settings.wordbook.automaticSync;
    element<HTMLButtonElement>("[data-manual-sync]").disabled = !this.settings.wordbook.enabled;
    element<HTMLInputElement>("[data-youtube-enabled]").checked = this.settings.youtube.enabled;
    element<HTMLInputElement>("[data-youtube-defaultBilingual]").checked =
      this.settings.youtube.defaultBilingual;
    element<HTMLInputElement>("[data-youtube-defaultBilingual]").disabled =
      !this.settings.youtube.enabled;
    element<HTMLButtonElement>("[data-youtube-shortcut]").textContent = shortcutLabel(
      this.settings.youtube.shortcut,
    );
    this.renderSiteRules();
  }

  private renderSiteRules(): void {
    const list = element<HTMLElement>("[data-site-rules]");
    list.replaceChildren();
    if (this.settings.sitePolicy.rules.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "还没有单独的网站规则。";
      list.append(empty);
      return;
    }
    for (const rule of this.settings.sitePolicy.rules) {
      const row = document.createElement("div");
      row.className = "rule-row";
      const copy = document.createElement("div");
      const host = document.createElement("strong");
      host.textContent = rule.hostname;
      const note = document.createElement("small");
      note.textContent = `${rule.action === "allow" ? "允许" : "阻止"}${rule.includeSubdomains ? " · 包含子域" : " · 仅此网站"}`;
      copy.append(host, note);
      const remove = document.createElement("button");
      remove.className = "quiet-button";
      remove.type = "button";
      remove.textContent = "移除";
      remove.addEventListener("click", () => {
        void this.save({
          ...this.settings,
          sitePolicy: {
            ...this.settings.sitePolicy,
            rules: this.settings.sitePolicy.rules.filter(
              (candidate) => candidate.hostname !== rule.hostname,
            ),
          },
        }).then(() => this.renderSiteRules());
      });
      row.append(copy, remove);
      list.append(row);
    }
  }

  private async refreshHostStatus(): Promise<void> {
    const container = element<HTMLElement>("[data-provider-list]");
    try {
      const status = await this.host.status();
      this.renderProviders(container, status);
      element<HTMLElement>("[data-platform-label]").textContent =
        status.platform === "macos" ? "macOS 本机配置" : "Windows 固定 DeepSeek";
    } catch (error) {
      container.textContent = error instanceof Error ? error.message : "无法读取本机配置。";
      container.dataset.error = "true";
    }
  }

  private renderProviders(container: HTMLElement, status: SettingsStatusResultEvent): void {
    container.replaceChildren();
    for (const item of status.providers) {
      const row = document.createElement("button");
      row.className = "provider-row";
      row.type = "button";
      row.disabled = item.status !== "ready" || item.provider === status.currentProvider;
      const copy = document.createElement("span");
      const label = document.createElement("strong");
      label.textContent = PROVIDER_LABELS[item.provider];
      const note = document.createElement("small");
      note.textContent =
        item.provider === status.currentProvider
          ? "当前使用"
          : item.status === "ready"
            ? "已配置"
            : item.status === "unsupported"
              ? "此平台不支持"
              : "尚未配置";
      copy.append(label, note);
      const marker = document.createElement("span");
      marker.className = "provider-marker";
      marker.textContent = item.provider === status.currentProvider ? "✓" : "选择";
      row.append(copy, marker);
      row.addEventListener("click", () => {
        void this.host.selectProvider(item.provider).then(
          () => this.refreshHostStatus(),
          (error: unknown) =>
            setStatus(error instanceof Error ? error.message : "Provider 切换失败。", "error"),
        );
      });
      container.append(row);
    }
  }
}

if (typeof chrome !== "undefined") {
  void new OptionsPage().initialize().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : "设置页初始化失败。", "error");
  });
}
