import {
  createYouTubeBridge,
  type YouTubeBridgeEnvironment,
  type YouTubePlayer,
} from "./youtube-bridge-core.js";

interface YouTubeWindow extends Window {
  movie_player?: YouTubePlayer;
}

function getLivePlayer(windowRef: YouTubeWindow, documentRef: Document): YouTubePlayer | null {
  const candidate = documentRef.getElementById("movie_player") ?? windowRef.movie_player;
  if (
    candidate === null ||
    typeof (candidate as Partial<YouTubePlayer>).getPlayerResponse !== "function" ||
    typeof (candidate as Partial<YouTubePlayer>).getOption !== "function" ||
    typeof (candidate as Partial<YouTubePlayer>).setOption !== "function" ||
    typeof (candidate as Partial<YouTubePlayer>).loadModule !== "function" ||
    typeof (candidate as Partial<YouTubePlayer>).unloadModule !== "function"
  ) {
    return null;
  }
  return candidate as unknown as YouTubePlayer;
}

const windowRef = window as YouTubeWindow;
createYouTubeBridge(windowRef as unknown as YouTubeBridgeEnvironment, () =>
  getLivePlayer(windowRef, document),
);
