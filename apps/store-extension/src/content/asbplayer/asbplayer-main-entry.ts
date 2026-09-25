import { parseLocalStreamUrl } from "../../asbplayer-stream-url.js";
import { createAsbplayerAdapter } from "./asbplayer-adapter.js";
import { readAsbplayerPlaybackContext } from "./asbplayer-location.js";
import { installAsbplayerMainBridge } from "./asbplayer-main-bridge.js";
import { installLocalMediaImport } from "./asbplayer-local-import.js";
import { installStreamMediaCors } from "./asbplayer-local-stream.js";
installLocalMediaImport(document);
const context = readAsbplayerPlaybackContext(window);
if (context !== null) {
  if (parseLocalStreamUrl(context.mediaUrl)) installStreamMediaCors(document, context.mediaUrl);
  installAsbplayerMainBridge({
    window,
    createAdapter: () =>
      createAsbplayerAdapter({
        readContext: () => readAsbplayerPlaybackContext(window),
        createChannel: (name) => new BroadcastChannel(name),
      }),
  });
}
