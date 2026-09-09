export function createWriteIntents(
  store: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  },
  newKey: () => string,
) {
  return {
    key(scope: string, input: unknown) {
      const body = JSON.stringify(input);
      const stored = store.get(`write:${scope}`);
      if (
        typeof stored === "object" &&
        stored !== null &&
        "body" in stored &&
        stored.body === body &&
        "key" in stored &&
        typeof stored.key === "string"
      )
        return stored.key;
      const key = newKey();
      store.set(`write:${scope}`, { key, body });
      return key;
    },
    acknowledge(scope: string, key: string) {
      const stored = store.get(`write:${scope}`);
      if (typeof stored === "object" && stored !== null && "key" in stored && stored.key === key)
        store.remove(`write:${scope}`);
    },
  };
}
