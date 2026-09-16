// Tab URLs require additional host permissions. Ask our own top-frame content script instead.
export async function isBackfillTab(tabId: number): Promise<boolean> {
  try {
    const result: unknown = await chrome.tabs.sendMessage(
      tabId,
      { type: "store/backfill-probe" },
      { frameId: 0 },
    );
    return (
      typeof result === "object" &&
      result !== null &&
      "shanbayCollection" in result &&
      result.shanbayCollection === true
    );
  } catch {
    return false;
  }
}

export async function findBackfillTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  const matches = await Promise.all(
    tabs.map(async (tab) =>
      tab.id !== undefined && (await isBackfillTab(tab.id)) ? tab : undefined,
    ),
  );
  return matches.find((tab) => tab !== undefined);
}
