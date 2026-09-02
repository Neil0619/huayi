import {
  STORE_MESSAGE_VERSION,
  isSiteEnabled,
  parseStoreSitePolicyRequest,
  type StoreAppearance,
  type StoreSettings,
  type StoreSitePolicyResponse,
} from "@huayi/store-domain";

interface SiteSettingsRepository {
  get(): Promise<StoreSettings>;
  setSiteEnabled(host: string, enabled: boolean): Promise<void>;
}

export function isSitePolicyMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    (value.type === "store/site-policy" || value.type === "store/site-toggle")
  );
}

export function siteHostFromSenderUrl(senderUrl: string | undefined): string | null {
  if (senderUrl === undefined) return null;
  try {
    const url = new URL(senderUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    return host.length >= 1 && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

export async function handleSitePolicyMessage(
  value: unknown,
  senderUrl: string | undefined,
  settingsRepository: SiteSettingsRepository,
  readAppearance: () => Promise<StoreAppearance>,
): Promise<StoreSitePolicyResponse | undefined> {
  if (!isSitePolicyMessage(value)) return undefined;
  const host = siteHostFromSenderUrl(senderUrl);
  if (host === null) return undefined;
  let request;
  try {
    request = parseStoreSitePolicyRequest(value);
  } catch {
    return undefined;
  }
  const [appearance, settings] = await Promise.all([readAppearance(), settingsRepository.get()]);
  if (request.type === "store/site-toggle") {
    await settingsRepository.setSiteEnabled(host, request.enabled);
  }
  return {
    appearance,
    defaultAction: settings.defaultAction,
    enabled:
      request.type === "store/site-toggle"
        ? settings.globallyEnabled && request.enabled
        : isSiteEnabled(settings, host),
    globallyEnabled: settings.globallyEnabled,
    host,
    messageVersion: STORE_MESSAGE_VERSION,
    overlayTheme: settings.overlayTheme,
    type: "store/site-policy-result",
  };
}
