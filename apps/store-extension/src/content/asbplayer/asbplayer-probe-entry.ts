import { createAsbplayerAdapter } from "./asbplayer-adapter.js";
import { readAsbplayerPlaybackContext } from "./asbplayer-location.js";
import { mountAsbplayerProbe } from "./asbplayer-probe.js";

const readContext = () => readAsbplayerPlaybackContext(window);
if (readContext() !== null) {
  const adapter = createAsbplayerAdapter({
    readContext,
    createChannel: (name) => new BroadcastChannel(name),
  });
  mountAsbplayerProbe({ document, adapter, readContext });
}
