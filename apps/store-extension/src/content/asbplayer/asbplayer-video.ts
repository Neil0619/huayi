function visibleInViewport(video: HTMLVideoElement, view: Window): boolean {
  for (let element: HTMLElement | null = video; element !== null; element = element.parentElement) {
    const style = view.getComputedStyle(element);
    if (
      element.hidden ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return false;
  }
  const bounds = video.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.right > 0 &&
    bounds.bottom > 0 &&
    bounds.left < view.innerWidth &&
    bounds.top < view.innerHeight
  );
}

/** Pinned upstream main/preview videos share src; src alone is not a player identity. */
export function selectAsbplayerVideo(
  document: Document,
  mediaUrl: string,
): HTMLVideoElement | null {
  const view = document.defaultView;
  if (view === null) return null;
  const matches = [
    ...document.querySelectorAll<HTMLVideoElement>(".asbplayer-token-container > video"),
  ].filter(
    (video) =>
      video.isConnected &&
      video.getAttribute("src") === mediaUrl &&
      video.preload === "auto" &&
      !video.controls &&
      visibleInViewport(video, view),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
