import { PopupPage } from "./popup-page.js";

const page = new PopupPage({
  openOptionsPage: () => chrome.runtime.openOptionsPage(),
  queryActiveTab: async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return typeof tab?.id === "number" ? { id: tab.id } : null;
  },
  sendRuntimeMessage: (message) => chrome.runtime.sendMessage(message),
  sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
});

void page.initialize();
