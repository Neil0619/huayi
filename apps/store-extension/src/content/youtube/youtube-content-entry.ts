import {
  storeSubtitleRuntime,
  sendStoreSubtitleMessage,
} from "../subtitles/store-subtitle-runtime.js";
import { bootstrapStoreContentScript } from "../content-bootstrap.js";
import { getOrCreateStoreOverlay } from "../overlay/store-overlay-registry.js";
import { getOrCreateStoreSiteLifecycle } from "../site-lifecycle-registry.js";
import { installStoreSitePolicyRelay } from "../site-policy-relay.js";
import { YouTubeIntegration } from "./youtube-integration.js";
import { createYouTubeStartupRetryExecutor } from "./youtube-startup-retry.js";

const overlay = getOrCreateStoreOverlay(document, storeSubtitleRuntime);
const lifecycle = getOrCreateStoreSiteLifecycle(sendStoreSubtitleMessage);
const runStartupStep = createYouTubeStartupRetryExecutor();
installStoreSitePolicyRelay(lifecycle, {
  addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
  extensionId: chrome.runtime.id,
});
const youtube = new YouTubeIntegration({
  document,
  overlay,
  runStartupStep,
  sendMessage: sendStoreSubtitleMessage,
});

void bootstrapStoreContentScript({
  createApp: () => ({
    async start() {
      lifecycle.register("youtube", youtube);
      await runStartupStep(() => lifecycle.refresh());
    },
  }),
  createRequestId: () => crypto.randomUUID(),
  runStartupStep,
  sendMessage: sendStoreSubtitleMessage,
});
