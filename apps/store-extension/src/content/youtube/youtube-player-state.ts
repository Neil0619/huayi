export function isUsableYouTubePlayer(player: HTMLElement, video: HTMLVideoElement): boolean {
  return (
    player.isConnected &&
    !player.classList.contains("ad-showing") &&
    !player.classList.contains("ytp-live") &&
    video.duration !== Number.POSITIVE_INFINITY &&
    !video.ended
  );
}

export function captionToggleState(player: HTMLElement): "off" | "on" | "unknown" {
  const pressed = player
    .querySelector<HTMLElement>(".ytp-subtitles-button")
    ?.getAttribute("aria-pressed");
  if (pressed === "true") return "on";
  if (pressed === "false") return "off";
  return "unknown";
}

export function visibleCaptionText(player: HTMLElement): string | null {
  return player.querySelector(".ytp-caption-segment")?.textContent?.trim() || null;
}
