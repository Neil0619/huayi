import { createAsbplayerAdapter } from "./asbplayer-adapter.js";
import { readAsbplayerPlaybackContext } from "./asbplayer-location.js";
import { installAsbplayerMainBridge } from "./asbplayer-main-bridge.js";
if (readAsbplayerPlaybackContext(window) !== null) {
  installAsbplayerMainBridge({
    window,
    createAdapter: () =>
      createAsbplayerAdapter({
        readContext: () => readAsbplayerPlaybackContext(window),
        createChannel: (name) => new BroadcastChannel(name),
      }),
  });
}
