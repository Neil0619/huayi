import {
  STORE_MESSAGE_VERSION,
  parseStorePopupStatusRequest,
  parseStorePopupPreferenceRequest,
  type StoreAppearance,
  type StorePopupStatusResponse,
  type StoreSettings,
} from "@huayi/store-domain";

interface PopupSender {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
}

interface PopupStatusDependencies {
  readonly getAppearance: () => Promise<StoreAppearance>;
  readonly getSettings: () => Promise<StoreSettings>;
  readonly notifySettingsChanged: () => Promise<void>;
  readonly setGloballyEnabled: (enabled: boolean) => Promise<void>;
  readonly setOverlayTheme: (theme: StoreSettings["overlayTheme"]) => Promise<void>;
}

export function isPopupStatusMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    (value.type === "store/popup-status" ||
      value.type === "store/popup-global-toggle" ||
      value.type === "store/popup-overlay-theme")
  );
}

function isExactPopupSender(sender: PopupSender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === extensionId &&
      url.pathname === "/popup.html" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export async function handlePopupStatusMessage(
  value: unknown,
  sender: PopupSender,
  extensionId: string,
  dependencies: PopupStatusDependencies,
): Promise<StorePopupStatusResponse | undefined> {
  if (!isPopupStatusMessage(value) || !isExactPopupSender(sender, extensionId)) return undefined;
  try {
    if (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "store/popup-status"
    ) {
      parseStorePopupStatusRequest(value);
    } else {
      const preference = parseStorePopupPreferenceRequest(value);
      if (preference.type === "store/popup-global-toggle") {
        await dependencies.setGloballyEnabled(preference.enabled);
      } else {
        await dependencies.setOverlayTheme(preference.overlayTheme);
      }
      await dependencies.notifySettingsChanged();
    }
  } catch {
    return undefined;
  }
  const [appearance, settings] = await Promise.all([
    dependencies.getAppearance(),
    dependencies.getSettings(),
  ]);
  return {
    appearance,
    globallyEnabled: settings.globallyEnabled,
    messageVersion: STORE_MESSAGE_VERSION,
    modelConsentGranted: settings.networkConsent !== null,
    overlayTheme: settings.overlayTheme,
    providerId: settings.providerId,
    type: "store/popup-status-result",
  };
}
