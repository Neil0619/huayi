import { bootstrapStoreContentScript } from "../content-bootstrap.js";
import { getOrCreateStoreSiteLifecycle } from "../site-lifecycle-registry.js";
import { installStoreSitePolicyRelay } from "../site-policy-relay.js";
import { isExactShanbayCollectionPage } from "./shanbay-sync-controller.js";
import { BackfillPageController } from "./backfill-page-controller.js";

const isCollection = () => window === window.top && isExactShanbayCollectionPage(window.location);

if (isCollection()) {
  const lifecycle = getOrCreateStoreSiteLifecycle((message) => chrome.runtime.sendMessage(message));
  installStoreSitePolicyRelay(lifecycle, {
    addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
    extensionId: chrome.runtime.id,
  });
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
        shanbayCollection: isCollection(),
      });
      return;
    }
    if (
      sender.id === chrome.runtime.id &&
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "store/backfill-activate" &&
      isCollection()
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
}
