/** Only observe encrypted ledger changes; the worker validates the account before returning counts. */
export function subscribeToBackfillProgress(onChanged: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && "huayi.store.shanbay-backfill.v1" in changes) onChanged();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
