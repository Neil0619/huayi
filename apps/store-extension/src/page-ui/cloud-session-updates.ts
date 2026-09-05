/** Observe only the key change; encrypted credentials never enter the page controller. */
export function subscribeToCloudSession(onChanged: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (
      area === "local" &&
      ("huayi.store.cloud.session" in changes || "huayi.store.cloud.pairing" in changes)
    )
      onChanged();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
