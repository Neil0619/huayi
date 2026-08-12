import type { ModelProvider, SettingsStatusResultEvent } from "@huayi/protocol";

import type { SettingsHostClient } from "../settings/settings-host-client.js";

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

export class OptionsProviderController {
  constructor(
    private readonly host: SettingsHostClient,
    private readonly setStatus: (message: string, tone: "error") => void,
  ) {}

  async refresh(): Promise<void> {
    const container = element<HTMLElement>("[data-provider-list]");
    try {
      const status = await this.host.status();
      this.render(container, status);
      element<HTMLElement>("[data-platform-label]").textContent =
        status.platform === "macos" ? "macOS 本机配置" : "Windows 固定 DeepSeek";
    } catch (error) {
      container.textContent = error instanceof Error ? error.message : "无法读取本机配置。";
      container.dataset.error = "true";
    }
  }

  private render(container: HTMLElement, status: SettingsStatusResultEvent): void {
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
          () => this.refresh(),
          (error: unknown) =>
            this.setStatus(error instanceof Error ? error.message : "Provider 切换失败。", "error"),
        );
      });
      container.append(row);
    }
  }
}
