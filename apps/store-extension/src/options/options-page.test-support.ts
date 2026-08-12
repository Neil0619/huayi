import { readFileSync } from "node:fs";

import type {
  CredentialSlot,
  DeviceVault,
  DataRecipient,
  DeviceVaultReadiness,
  StoreSettings,
  StoreSettingsRepository,
} from "@huayi/store-domain";
import { vi } from "vitest";

import { OptionsPage } from "./options-page.js";

const optionsHtml = readFileSync("apps/store-extension/pages/options.html", "utf8");

const defaultSettings: StoreSettings = {
  defaultAction: "ask",
  globallyEnabled: true,
  networkConsent: null,
  overlayTheme: "pearl",
  providerId: "openai",
  recipientAccess: {
    eudic: { consent: null, enabled: false },
    shanbay: { consent: null, enabled: false },
  },
  schemaVersion: 6,
  sitePolicy: {
    defaultAction: "allow",
    rules: [
      { action: "block", hostname: "blocked.example", includeSubdomains: false },
      { action: "block", hostname: "news.example", includeSubdomains: false },
    ],
  },
  youtubeMode: "english",
  youtubeShortcut: null,
};

export function renderPage(): void {
  document.documentElement.innerHTML = optionsHtml;
  history.replaceState(null, "", "/options.html");
}

export function element<ElementType extends HTMLElement>(selector: string): ElementType {
  const found = document.querySelector<ElementType>(selector);
  if (found === null) throw new Error(`Missing test element: ${selector}`);
  return found;
}

export function submit(selector: string): void {
  element<HTMLFormElement>(selector).dispatchEvent(new Event("submit", { cancelable: true }));
}

export function createHarness(readiness: DeviceVaultReadiness = "ready"): {
  page: OptionsPage;
  settings: StoreSettingsRepository;
  vault: DeviceVault;
  notifySitePolicyChanged: ReturnType<typeof vi.fn>;
} {
  const credentials = new Map<CredentialSlot, string>();
  const vault: DeviceVault = {
    deleteCredential: vi.fn(async (slot) => {
      credentials.delete(slot);
    }),
    ensureReady: vi.fn(async () => {
      if (readiness === "migration-required") {
        throw Object.assign(new Error(), { code: "legacy-migration-required" });
      }
    }),
    getDek: vi.fn(async () => new Uint8Array(32)),
    getCredential: vi.fn(async (slot) => credentials.get(slot) ?? null),
    getReadiness: vi.fn(async () => readiness),
    migrateLegacy: vi.fn(async () => {
      readiness = "ready";
    }),
    setCredential: vi.fn(async (slot, value) => {
      credentials.set(slot, value);
    }),
  };
  let currentSettings = structuredClone(defaultSettings);
  const settings: StoreSettingsRepository = {
    get: vi.fn(async () => structuredClone(currentSettings)),
    grantNetworkConsent: vi.fn(async (grantedAt) => {
      currentSettings = {
        ...currentSettings,
        networkConsent: { grantedAt: grantedAt.toISOString(), version: 1 },
      };
    }),
    grantRecipientConsent: vi.fn(async (recipient: DataRecipient, grantedAt: Date) => {
      currentSettings = {
        ...currentSettings,
        recipientAccess: {
          ...currentSettings.recipientAccess,
          [recipient]: {
            consent: { grantedAt: grantedAt.toISOString(), version: 1 },
            enabled: false,
          },
        },
      };
    }),
    revokeNetworkConsent: vi.fn(async () => {
      currentSettings = { ...currentSettings, networkConsent: null };
    }),
    revokeRecipientConsent: vi.fn(async (recipient: DataRecipient) => {
      currentSettings = {
        ...currentSettings,
        recipientAccess: {
          ...currentSettings.recipientAccess,
          [recipient]: { consent: null, enabled: false },
        },
      };
    }),
    setRecipientEnabled: vi.fn(async (recipient: DataRecipient, enabled: boolean) => {
      currentSettings = {
        ...currentSettings,
        recipientAccess: {
          ...currentSettings.recipientAccess,
          [recipient]: { ...currentSettings.recipientAccess[recipient], enabled },
        },
      };
    }),
    setProvider: vi.fn(async (providerId) => {
      currentSettings = { ...currentSettings, providerId };
    }),
    setDefaultAction: vi.fn(async (defaultAction) => {
      currentSettings = { ...currentSettings, defaultAction };
    }),
    setGloballyEnabled: vi.fn(async (globallyEnabled) => {
      currentSettings = { ...currentSettings, globallyEnabled };
    }),
    setOverlayTheme: vi.fn(async (overlayTheme) => {
      currentSettings = { ...currentSettings, overlayTheme };
    }),
    setSiteEnabled: vi.fn(async (host, enabled) => {
      currentSettings = {
        ...currentSettings,
        sitePolicy: {
          ...currentSettings.sitePolicy,
          rules: [
            ...currentSettings.sitePolicy.rules.filter(
              (rule) => rule.hostname !== host || rule.includeSubdomains,
            ),
            {
              action: enabled ? ("allow" as const) : ("block" as const),
              hostname: host,
              includeSubdomains: false,
            },
          ].sort(
            (left, right) =>
              left.hostname.localeCompare(right.hostname) ||
              Number(left.includeSubdomains) - Number(right.includeSubdomains),
          ),
        },
      };
    }),
    setYoutubeMode: vi.fn(async (youtubeMode) => {
      currentSettings = { ...currentSettings, youtubeMode };
    }),
    setYoutubeShortcut: vi.fn(async (youtubeShortcut) => {
      currentSettings = { ...currentSettings, youtubeShortcut };
    }),
  };
  const notifySitePolicyChanged = vi.fn(async () => undefined);
  return {
    notifySitePolicyChanged,
    page: new OptionsPage({
      notifySitePolicyChanged,
      settings,
      vault,
    }),
    settings,
    vault,
  };
}
