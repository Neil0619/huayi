import {
  STORE_ANALYSIS_PORT_NAME,
  STORE_MESSAGE_VERSION,
  type StoreOpenOptionsRequest,
} from "@huayi/store-domain";

import { bootstrapStoreContentScript } from "../content-bootstrap.js";
import {
  type ContentAnalysisPort,
  type StoreOverlayRuntime,
} from "../overlay/store-overlay-controller.js";
import { getOrCreateStoreOverlay } from "../overlay/store-overlay-registry.js";
import { getOrCreateStoreSiteLifecycle } from "../site-lifecycle-registry.js";
import { installStoreSitePolicyRelay } from "../site-policy-relay.js";
import { YouTubeIntegration } from "./youtube-integration.js";
import { createYouTubeStartupRetryExecutor } from "./youtube-startup-retry.js";

const runtime: StoreOverlayRuntime = {
  connectAnalysis: () =>
    chrome.runtime.connect({ name: STORE_ANALYSIS_PORT_NAME }) as ContentAnalysisPort,
  openOptions: async () => {
    const message: StoreOpenOptionsRequest = {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/open-options",
    };
    await chrome.runtime.sendMessage(message);
  },
  overlayStylesheetUrl: () => chrome.runtime.getURL("overlay.css"),
  queryWordPresence: (request) => chrome.runtime.sendMessage(request),
  saveWord: (request) => chrome.runtime.sendMessage(request),
};
const overlay = getOrCreateStoreOverlay(document, runtime);
const lifecycle = getOrCreateStoreSiteLifecycle((message) => chrome.runtime.sendMessage(message));
const runStartupStep = createYouTubeStartupRetryExecutor();
installStoreSitePolicyRelay(lifecycle, {
  addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
  extensionId: chrome.runtime.id,
});
const youtube = new YouTubeIntegration({
  document,
  overlay,
  runStartupStep,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
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
  sendMessage: (message) => chrome.runtime.sendMessage(message),
});
