import {
  STORE_ANALYSIS_PORT_NAME,
  STORE_MESSAGE_VERSION,
  type StoreOpenWebWorkspaceRequest,
  parseStoreOpenWebWorkspaceResponse,
  type StoreOpenOptionsRequest,
} from "@huayi/store-domain";

import { bootstrapStoreContentScript } from "./content-bootstrap.js";
import {
  type ContentAnalysisPort,
  type StoreOverlayRuntime,
} from "./overlay/store-overlay-controller.js";
import { getOrCreateStoreOverlay } from "./overlay/store-overlay-registry.js";
import { getOrCreateStoreSiteLifecycle } from "./site-lifecycle-registry.js";
import { installStoreSitePolicyRelay } from "./site-policy-relay.js";
import { StoreContentApp } from "./store-content-app.js";
import {
  ShanbaySyncController,
  isExactShanbayCollectionPage,
} from "./shanbay/shanbay-sync-controller.js";

function chromeRuntime(): StoreOverlayRuntime {
  return {
    connectAnalysis: () =>
      chrome.runtime.connect({ name: STORE_ANALYSIS_PORT_NAME }) as ContentAnalysisPort,
    openOptions: async () => {
      const message: StoreOpenOptionsRequest = {
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/open-options",
      };
      await chrome.runtime.sendMessage(message);
    },
    openWebWorkspace: async () => {
      const message: StoreOpenWebWorkspaceRequest = {
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/open-web-workspace",
      };
      const response = parseStoreOpenWebWorkspaceResponse(
        await chrome.runtime.sendMessage(message),
      );
      if (!response.opened) throw new Error("Web workspace is not configured.");
    },
    overlayStylesheetUrl: () => chrome.runtime.getURL("overlay.css"),
    queryWordPresence: (request) => chrome.runtime.sendMessage(request),
    saveWord: (request) => chrome.runtime.sendMessage(request),
    studyCapture: (request) => chrome.runtime.sendMessage(request),
  };
}

const lifecycle = getOrCreateStoreSiteLifecycle((message) => chrome.runtime.sendMessage(message));
installStoreSitePolicyRelay(lifecycle, {
  addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
  extensionId: chrome.runtime.id,
});

if (isExactShanbayCollectionPage(window.location)) {
  const shanbay = new ShanbaySyncController({
    document,
    sendMessage: (message) => chrome.runtime.sendMessage(message),
  });
  void bootstrapStoreContentScript({
    createApp: () => ({
      start() {
        lifecycle.register("shanbay", shanbay);
        void lifecycle.refresh().catch(() => undefined);
      },
    }),
    createRequestId: () => crypto.randomUUID(),
    sendMessage: (message) => chrome.runtime.sendMessage(message),
  });
} else {
  const content = new StoreContentApp(document, getOrCreateStoreOverlay(document, chromeRuntime()));
  void bootstrapStoreContentScript({
    createApp: () => ({
      start() {
        lifecycle.register("ordinary", content);
        void lifecycle.refresh().catch(() => undefined);
      },
    }),
    createRequestId: () => crypto.randomUUID(),
    sendMessage: (message) => chrome.runtime.sendMessage(message),
  });
}
