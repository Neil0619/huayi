import {
  createYouTubeMainBridge,
  type YouTubeMainBridgeEnvironment,
  type YouTubeMainPlayer,
} from "./youtube-main-bridge.js";

interface YouTubeWindow extends Window {
  movie_player?: YouTubeMainPlayer;
}

function getPlayer(windowRef: YouTubeWindow, documentRef: Document): YouTubeMainPlayer | null {
  const value = documentRef.getElementById("movie_player") ?? windowRef.movie_player;
  if (
    value === null ||
    typeof (value as Partial<YouTubeMainPlayer>).getPlayerResponse !== "function" ||
    typeof (value as Partial<YouTubeMainPlayer>).getOption !== "function" ||
    typeof (value as Partial<YouTubeMainPlayer>).setOption !== "function" ||
    typeof (value as Partial<YouTubeMainPlayer>).loadModule !== "function" ||
    typeof (value as Partial<YouTubeMainPlayer>).unloadModule !== "function"
  ) {
    return null;
  }
  return value as unknown as YouTubeMainPlayer;
}

const windowRef = window as YouTubeWindow;
createYouTubeMainBridge(windowRef as unknown as YouTubeMainBridgeEnvironment, () =>
  getPlayer(windowRef, document),
);
