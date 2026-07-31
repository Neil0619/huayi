export const PLAYER_SELECTOR = ".html5-video-player";
export const SUBTITLES_BUTTON_SELECTOR = ".ytp-subtitles-button";

export function canUseCaptionPlayer(player: HTMLElement, video: HTMLVideoElement): boolean {
  return (
    !player.classList.contains("ad-showing") &&
    !player.classList.contains("ytp-live") &&
    video.duration !== Number.POSITIVE_INFINITY &&
    !video.ended
  );
}
