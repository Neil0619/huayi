export function analysisSourceTypeFromSenderUrl(
  value: string | undefined,
): "web-selection" | "youtube-caption" {
  if (value === undefined) return "web-selection";
  try {
    const url = new URL(value);
    const youtube = url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com");
    return youtube && url.pathname === "/watch" ? "youtube-caption" : "web-selection";
  } catch {
    return "web-selection";
  }
}
