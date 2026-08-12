import type {
  CredentialSlot,
  DataRecipient,
  DeviceVault,
  StoreSettings,
  StoreSettingsRepository,
} from "@huayi/store-domain";
import { recipientAccessDecision } from "@huayi/store-domain";

import { UserFacingError, userMessage } from "./options-errors.js";
import { OptionsNonSensitiveControls } from "./options-non-sensitive-controls.js";
import { OptionsSectionNavigation } from "./options-section-navigation.js";

const PROVIDER_CREDENTIALS = [
  "openai-api-key",
  "deepseek-api-key",
] as const satisfies readonly CredentialSlot[];
const DATA_RECIPIENTS = ["eudic", "shanbay"] as const satisfies readonly DataRecipient[];

interface OptionsPageDependencies {
  readonly lexiconOptions?: {
    initialize(ready: boolean): Promise<void>;
    setReady(ready: boolean): Promise<void>;
  };
  readonly notifySitePolicyChanged?: () => Promise<void>;
  readonly settings: StoreSettingsRepository;
  readonly vault: DeviceVault;
}

function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing Store options element: ${selector}`);
  return found;
}

export class OptionsPage {
  private busy = false;
  private readonly credentialConfigured = new Map<CredentialSlot, boolean>();
  private readonly nonSensitiveControls: OptionsNonSensitiveControls;
  private readonly sectionNavigation = new OptionsSectionNavigation();
  private ready = false;
  private settings: StoreSettings | null = null;

  constructor(private readonly dependencies: OptionsPageDependencies) {
    this.nonSensitiveControls = new OptionsNonSensitiveControls({
      execute: (operation, success) => void this.execute(operation, success),
      notifySitePolicyChanged: dependencies.notifySitePolicyChanged ?? (async () => undefined),
      refreshSettings: () => this.refreshSettings(),
      settings: dependencies.settings,
    });
  }

  async initialize(): Promise<void> {
    this.sectionNavigation.initialize();
    this.bindEvents();
    this.render();
    await this.dependencies.lexiconOptions?.initialize(false);
    await this.execute(async () => {
      this.settings = await this.dependencies.settings.get();
      const readiness = await this.dependencies.vault.getReadiness();
      if (readiness !== "ready") {
        throw new UserFacingError(
          "检测到不兼容的旧版本地数据。Store 1.0 不再提供迁移，请清除扩展数据后重新配置。",
        );
      }
      await this.activateDeviceVault();
    }, "");
  }

  private bindEvents(): void {
    this.nonSensitiveControls.bind();
    for (const recipient of DATA_RECIPIENTS) {
      this.bindButton(
        `[data-recipient-grant='${recipient}']`,
        async () => {
          await this.dependencies.settings.grantRecipientConsent(recipient, new Date());
          await this.refreshSettings();
        },
        `${recipient === "eudic" ? "欧路" : "扇贝"}数据说明已同意；导出仍保持停用。`,
      );
      this.bindButton(
        `[data-recipient-revoke='${recipient}']`,
        async () => {
          await this.dependencies.settings.revokeRecipientConsent(recipient);
          await this.refreshSettings();
        },
        `${recipient === "eudic" ? "欧路" : "扇贝"}同意已撤回，相关外发已停用。`,
      );
      element<HTMLInputElement>(`[data-recipient-enabled='${recipient}']`).addEventListener(
        "change",
        (event) => {
          const enabled = (event.currentTarget as HTMLInputElement).checked;
          void this.execute(
            async () => {
              await this.dependencies.settings.setRecipientEnabled(recipient, enabled);
              await this.refreshSettings();
            },
            `${recipient === "eudic" ? "欧路" : "扇贝"}外发设置已更新。`,
          );
        },
      );
    }

    this.bindButton(
      "[data-grant-consent]",
      async () => {
        await this.dependencies.settings.grantNetworkConsent(new Date());
        await this.refreshSettings();
      },
      "已同意联网。分析时才会发送所选文本和必要上下文。",
    );
    this.bindButton(
      "[data-revoke-consent]",
      async () => {
        await this.dependencies.settings.revokeNetworkConsent();
        await this.refreshSettings();
      },
      "已撤回联网同意，模型分析已停用。",
    );

    for (const slot of PROVIDER_CREDENTIALS) {
      this.bindButton(
        `[data-credential-save='${slot}']`,
        async () => {
          const input = element<HTMLInputElement>(`[data-credential-input='${slot}']`);
          if (input.value.trim().length === 0) throw new UserFacingError("密钥不能为空。");
          await this.dependencies.vault.setCredential(slot, input.value.trim());
          input.value = "";
          this.credentialConfigured.set(slot, true);
        },
        "密钥已加密保存。已有密钥不会在页面中显示。",
      );
      this.bindButton(
        `[data-credential-delete='${slot}']`,
        async () => {
          await this.dependencies.vault.deleteCredential(slot);
          this.credentialConfigured.set(slot, false);
        },
        "密钥已删除。",
      );
    }
  }

  private async activateDeviceVault(): Promise<void> {
    await this.dependencies.vault.ensureReady();
    this.ready = true;
    await Promise.all([
      this.refreshCredentialStatus(),
      this.dependencies.lexiconOptions?.setReady(true),
    ]);
  }

  private bindButton(selector: string, operation: () => Promise<void>, _success: string): void {
    void _success;
    element<HTMLButtonElement>(selector).addEventListener("click", () => {
      void this.execute(operation);
    });
  }

  private async execute(
    operation: () => Promise<void>,
    legacySuccessMessage?: string,
  ): Promise<void> {
    void legacySuccessMessage;
    if (this.busy) return;
    this.busy = true;
    this.setStatus("正在处理…", "neutral");
    this.render();
    try {
      await operation();
      this.setStatus("", "neutral");
    } catch (error) {
      this.setStatus(userMessage(error), "error");
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async refreshSettings(): Promise<void> {
    this.settings = await this.dependencies.settings.get();
  }

  private async refreshCredentialStatus(): Promise<void> {
    for (const slot of PROVIDER_CREDENTIALS) {
      this.credentialConfigured.set(
        slot,
        (await this.dependencies.vault.getCredential(slot)) !== null,
      );
    }
  }

  private setStatus(message: string, tone: "error" | "neutral" | "success"): void {
    const status = element<HTMLElement>("[data-page-status]");
    status.textContent = message;
    status.dataset.tone = tone;
  }

  private render(): void {
    document.body.setAttribute("aria-busy", String(this.busy));
    element<HTMLElement>("[data-device-vault-ready]").hidden = !this.ready;
    const consented = this.settings?.networkConsent !== null && this.settings !== null;
    element("[data-consent-state]").textContent = consented ? "已同意联网" : "尚未同意联网";
    element<HTMLButtonElement>("[data-grant-consent]").hidden = consented;
    element<HTMLButtonElement>("[data-revoke-consent]").hidden = !consented;
    this.nonSensitiveControls.render(this.settings, this.busy);

    for (const slot of PROVIDER_CREDENTIALS) {
      const configured = this.credentialConfigured.get(slot) ?? false;
      element(`[data-credential-status='${slot}']`).textContent = configured ? "已配置" : "未配置";
      element<HTMLButtonElement>(`[data-credential-delete='${slot}']`).disabled =
        this.busy || !configured;
    }
    for (const control of document.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >("button, input, select")) {
      if (control.matches("[data-credential-delete]")) continue;
      control.disabled = this.busy;
    }

    for (const recipient of DATA_RECIPIENTS) {
      const decision =
        this.settings === null
          ? "consent-required"
          : recipientAccessDecision(this.settings, recipient);
      const consentCurrent = decision !== "consent-required";
      const enabled = decision === "allowed";
      element(`[data-recipient-state='${recipient}']`).textContent = !consentCurrent
        ? "尚未同意"
        : enabled
          ? "已同意并启用"
          : "已同意，未启用";
      element<HTMLButtonElement>(`[data-recipient-grant='${recipient}']`).hidden = consentCurrent;
      element<HTMLButtonElement>(`[data-recipient-revoke='${recipient}']`).hidden = !consentCurrent;
      const toggle = element<HTMLInputElement>(`[data-recipient-enabled='${recipient}']`);
      toggle.checked = enabled;
      toggle.disabled = this.busy || !consentCurrent;
    }
  }
}
