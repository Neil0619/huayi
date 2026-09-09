import Taro from "@tarojs/taro";
import { ownerId } from "./session";
import { createWriteIntents } from "./write-intent";

export function localKey(key: string) {
  return `seen-said:${ownerId()}:${key}`;
}
export const localStore = {
  get(key: string): unknown {
    return Taro.getStorageSync<unknown>(localKey(key));
  },
  set(key: string, value: unknown) {
    Taro.setStorageSync(localKey(key), value);
  },
  remove(key: string) {
    Taro.removeStorageSync(localKey(key));
  },
  clear() {
    const prefix = `seen-said:${ownerId()}:`;
    for (const key of Taro.getStorageInfoSync().keys)
      if (key.startsWith(prefix)) Taro.removeStorageSync(key);
  },
  clearDrafts() {
    const prefix = `seen-said:${ownerId()}:`;
    for (const key of Taro.getStorageInfoSync().keys) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      if (name === "collect-draft" || name.startsWith("practice-draft:"))
        Taro.removeStorageSync(key);
    }
  },
};
// Request identity only, never authentication material. Retained before any write.
export function writeKey() {
  return `mini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
export const writeIntents = createWriteIntents(localStore, writeKey);
export const mutationKey = writeIntents.key;
