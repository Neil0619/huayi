import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

export async function broadcastSettingsRefresh(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      typeof tab.id === "number"
        ? [
            chrome.tabs.sendMessage(tab.id, {
              messageVersion: STORE_MESSAGE_VERSION,
              type: "store/site-policy-refresh",
            }),
          ]
        : [],
    ),
  );
}
