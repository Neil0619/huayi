import { STORE_MESSAGE_VERSION, parseStoreSitePoliciesChangedResponse } from "@huayi/store-domain";
import {
  createChromeStoreAppearance,
  STORE_APPEARANCE_STORAGE_KEY,
} from "../service-worker/store-appearance.js";
import { PopupPage } from "./popup-page.js";
import { subscribeToCloudSession } from "../page-ui/cloud-session-updates.js";

const appearance = createChromeStoreAppearance(chrome.storage.local);
const page = new PopupPage({
  subscribeToCloudSession,
  appearance,
  notifySettingsChanged: async () => {
    parseStoreSitePoliciesChangedResponse(
      await chrome.runtime.sendMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policies-changed",
      }),
    );
  },
  openOptionsPage: () => chrome.runtime.openOptionsPage(),
  queryActiveTab: async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return typeof tab?.id === "number" ? { id: tab.id } : null;
  },
  sendRuntimeMessage: (message) => chrome.runtime.sendMessage(message),
  sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
});

void page.initialize();
const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area === "local" && STORE_APPEARANCE_STORAGE_KEY in changes) {
    void appearance.get().then((value) => page.applyAppearance(value));
  }
};
chrome.storage.onChanged.addListener(onStorageChanged);
window.addEventListener(
  "pagehide",
  () => chrome.storage.onChanged.removeListener(onStorageChanged),
  { once: true },
);
