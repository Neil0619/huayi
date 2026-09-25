import { parseLocalStreamUrl } from "../../asbplayer-stream-url.js";
const ASBPLAYER_ORIGIN = "https://app.asbplayer.dev";
const BLOB_PATH = /^\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/** Private routing context. Never include these values in snapshots or diagnostics. */
export interface AsbplayerPlaybackContext {
  readonly channel: string;
  readonly mediaUrl: string;
}

export type AsbplayerFrameContext = "top-level" | "official-frame" | "untrusted-frame";

export function parseAsbplayerPlaybackContext(
  href: string,
  frame: AsbplayerFrameContext,
): AsbplayerPlaybackContext | null {
  if ((frame !== "top-level" && frame !== "official-frame") || href.length > 4096) return null;
  try {
    const url = new URL(href);
    if (
      url.origin !== ASBPLAYER_ORIGIN ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.hash !== "" ||
      url.searchParams.getAll("video").length !== 1 ||
      url.searchParams.getAll("channel").length !== 1
    )
      return null;
    const channel = url.searchParams.get("channel");
    const mediaUrl = url.searchParams.get("video");
    if (channel === null || !/^[\w-]{1,128}$/u.test(channel) || mediaUrl === null) return null;
    if (parseLocalStreamUrl(mediaUrl)) return { channel, mediaUrl };
    const blob = new URL(mediaUrl);
    if (blob.protocol !== "blob:" || blob.origin !== ASBPLAYER_ORIGIN) return null;
    const inner = new URL(mediaUrl.slice(5));
    if (
      inner.origin !== ASBPLAYER_ORIGIN ||
      inner.username !== "" ||
      inner.password !== "" ||
      inner.search !== "" ||
      inner.hash !== "" ||
      !BLOB_PATH.test(inner.pathname) ||
      mediaUrl !== `blob:${inner.href}`
    )
      return null;
    return { channel, mediaUrl };
  } catch {
    return null;
  }
}

export function readAsbplayerPlaybackContext(view: Window): AsbplayerPlaybackContext | null {
  try {
    const frame =
      view === view.top
        ? "top-level"
        : view.parent.location.origin === ASBPLAYER_ORIGIN &&
            view.top?.location.origin === ASBPLAYER_ORIGIN
          ? "official-frame"
          : "untrusted-frame";
    return parseAsbplayerPlaybackContext(view.location.href, frame);
  } catch {
    // Accessing a cross-origin parent/top throws. It must never authorize an embedded player.
    return null;
  }
}

export function sameAsbplayerContext(
  left: AsbplayerPlaybackContext | null,
  right: AsbplayerPlaybackContext | null,
): boolean {
  return left?.channel === right?.channel && left?.mediaUrl === right?.mediaUrl;
}
