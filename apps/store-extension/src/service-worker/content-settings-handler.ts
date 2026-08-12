import {
  STORE_MESSAGE_VERSION,
  isSiteEnabled,
  parseStoreContentSettingsRequest,
  type StoreContentSettingsResponse,
  type StoreSettings,
} from "@huayi/store-domain";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

export function isContentSettingsMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "store/content-settings"
  );
}

function trustedYouTubeHost(value: string | undefined): string | null {
  if (value === undefined) return null;
  let sender: URL;
  try {
    sender = new URL(value);
  } catch {
    return null;
  }
  return sender.protocol === "https:" &&
    YOUTUBE_HOSTS.has(sender.hostname.toLowerCase()) &&
    sender.pathname === "/watch"
    ? sender.hostname.toLowerCase()
    : null;
}

export async function handleContentSettingsMessage(
  value: unknown,
  senderUrl: string | undefined,
  readSettings: () => Promise<
    Pick<StoreSettings, "globallyEnabled" | "sitePolicy" | "youtubeMode" | "youtubeShortcut">
  >,
): Promise<StoreContentSettingsResponse | undefined> {
  if (!isContentSettingsMessage(value)) return undefined;
  const host = trustedYouTubeHost(senderUrl);
  if (host === null) return undefined;
  try {
    parseStoreContentSettingsRequest(value);
  } catch {
    return undefined;
  }
  const settings = await readSettings();
  if (!isSiteEnabled(settings, host)) return undefined;
  return {
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/content-settings-result",
    youtubeMode: settings.youtubeMode,
    youtubeShortcut: settings.youtubeShortcut,
  };
}
