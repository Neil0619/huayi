import { parseLocalStreamUrl } from "../asbplayer-stream-url.js";
import {
  STORE_MESSAGE_VERSION,
  isSiteEnabled,
  parseStoreContentSettingsRequest,
  parseStoreAsbplayerSettingsRequest,
  parseStoreAsbplayerSettingsResponse,
  type StoreAsbplayerSettingsResponse,
  type StoreAppearance,
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
    (value.type === "store/content-settings" || value.type === "store/asbplayer-settings")
  );
}

function trustedAsbplayerHost(value: string | undefined): string | null {
  if (value === undefined || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const origin = "https://app.asbplayer.dev";
    if (
      url.origin !== origin ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll("video").length !== 1 ||
      url.searchParams.getAll("channel").length !== 1
    )
      return null;
    const media = url.searchParams.get("video") ?? "";
    const channel = url.searchParams.get("channel") ?? "";
    if (!/^[\w-]{1,128}$/u.test(channel)) return null;
    if (parseLocalStreamUrl(media)) return url.hostname;
    if (!media.startsWith(`blob:${origin}/`)) return null;
    const inner = new URL(media.slice(5));
    return inner.origin === origin &&
      !inner.username &&
      !inner.password &&
      !inner.search &&
      !inner.hash &&
      /^\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(inner.pathname) &&
      media === `blob:${inner.href}`
      ? url.hostname
      : null;
  } catch {
    return null;
  }
}

function trustedYouTubeHost(value: string | undefined): string | null {
  if (value === undefined) return null;
  let sender: URL;
  try {
    sender = new URL(value);
  } catch {
    return null;
  }
  // A content script's sender URL can retain its initial path across YouTube SPA navigation.
  // Authorize this presentation-settings read by HTTPS host; capture gates use the live /watch URL.
  return sender.protocol === "https:" && YOUTUBE_HOSTS.has(sender.hostname.toLowerCase())
    ? sender.hostname.toLowerCase()
    : null;
}

export async function handleContentSettingsMessage(
  value: unknown,
  senderUrl: string | undefined,
  readSettings: () => Promise<
    Pick<StoreSettings, "globallyEnabled" | "sitePolicy" | "youtubeMode" | "youtubeShortcut"> &
      Partial<Pick<StoreSettings, "asbplayerMode" | "asbplayerShortcut">>
  >,
  readAppearance: () => Promise<StoreAppearance>,
): Promise<StoreContentSettingsResponse | StoreAsbplayerSettingsResponse | undefined> {
  if (!isContentSettingsMessage(value)) return undefined;
  const asbplayer =
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "store/asbplayer-settings";
  const host = asbplayer ? trustedAsbplayerHost(senderUrl) : trustedYouTubeHost(senderUrl);
  if (host === null) return undefined;
  try {
    if (asbplayer) parseStoreAsbplayerSettingsRequest(value);
    else parseStoreContentSettingsRequest(value);
  } catch {
    return undefined;
  }
  const settings = await readSettings();
  if (!isSiteEnabled(settings, host)) return undefined;
  const appearance = await readAppearance();
  if (asbplayer)
    return parseStoreAsbplayerSettingsResponse({
      appearance,
      asbplayerMode: settings.asbplayerMode,
      asbplayerShortcut: settings.asbplayerShortcut,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/asbplayer-settings-result",
    });
  return {
    appearance,
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/content-settings-result",
    youtubeMode: settings.youtubeMode,
    youtubeShortcut: settings.youtubeShortcut,
  };
}
