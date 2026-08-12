const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

export function isYouTubeDocument(location: Location): boolean {
  return location.protocol === "https:" && YOUTUBE_HOSTS.has(location.hostname.toLowerCase());
}

export function isExactYouTubeWatchPage(location: Location): boolean {
  return isYouTubeDocument(location) && location.pathname === "/watch";
}

export function videoIdFromYouTubeLocation(location: Location): string | null {
  if (!isExactYouTubeWatchPage(location)) return null;
  const videoId = new URL(location.href).searchParams.get("v");
  return videoId !== null && videoId.length > 0 && videoId.length <= 128 ? videoId : null;
}
