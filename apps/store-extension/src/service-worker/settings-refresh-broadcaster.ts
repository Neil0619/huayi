import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

export async function broadcastSettingsRefresh(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    // Refresh is a notification: a suspended tab must not hold a saved setting open.
    void chrome.tabs
      .sendMessage(tab.id, {
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/site-policy-refresh",
      })
      .catch(() => undefined);
  }
}
