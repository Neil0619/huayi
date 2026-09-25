import {
  storeSubtitleRuntime,
  sendStoreSubtitleMessage,
} from "../subtitles/store-subtitle-runtime.js";
import { bootstrapStoreContentScript } from "../content-bootstrap.js";
import { getOrCreateStoreOverlay } from "../overlay/store-overlay-registry.js";
import { getOrCreateStoreSiteLifecycle } from "../site-lifecycle-registry.js";
import { installStoreSitePolicyRelay } from "../site-policy-relay.js";
import { AsbplayerIntegration } from "./asbplayer-integration.js";
import { createYouTubeStartupRetryExecutor } from "../youtube/youtube-startup-retry.js";
const overlay = getOrCreateStoreOverlay(document, storeSubtitleRuntime);
const lifecycle = getOrCreateStoreSiteLifecycle(sendStoreSubtitleMessage);
const runStartupStep = createYouTubeStartupRetryExecutor();
installStoreSitePolicyRelay(lifecycle, {
  addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
  extensionId: chrome.runtime.id,
});
const asbplayer = new AsbplayerIntegration({
  document,
  overlay,
  sendMessage: sendStoreSubtitleMessage,
});

void bootstrapStoreContentScript({
  createApp: () => ({
    async start() {
      lifecycle.register("asbplayer", asbplayer);
      try {
        await runStartupStep(() => lifecycle.refresh());
      } catch (error) {
        asbplayer.stop();
        throw error;
      }
    },
  }),
  createRequestId: () => crypto.randomUUID(),
  runStartupStep,
  sendMessage: sendStoreSubtitleMessage,
});
