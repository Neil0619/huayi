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
import { isExactShanbayCollectionPage } from "./shanbay/shanbay-sync-controller.js";
import { BackfillPageController } from "./shanbay/backfill-page-controller.js";

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
  const shanbay = new BackfillPageController({
    document,
    sendMessage: (message) => chrome.runtime.sendMessage(message),
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      sender.id === chrome.runtime.id &&
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "store/backfill-probe"
    ) {
      respond({
        shanbayCollection: window === window.top && isExactShanbayCollectionPage(window.location),
      });
      return;
    }
    if (
      sender.id === chrome.runtime.id &&
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "store/backfill-activate"
    ) {
      if ("view" in message && message.view === "review") void shanbay.openReview();
      else void shanbay.activate();
    }
  });
  window.addEventListener("pagehide", () => shanbay.stop(), { once: true });
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
