export const STORE_APPEARANCES = ["moon", "silver", "champagne", "porcelain"] as const;

export type StoreAppearance = (typeof STORE_APPEARANCES)[number];

export const DEFAULT_STORE_APPEARANCE: StoreAppearance = "silver";

export function parseStoreAppearance(value: unknown): StoreAppearance {
  if (value === "moon" || value === "silver" || value === "champagne" || value === "porcelain") {
    return value;
  }
  throw new TypeError("Store appearance is invalid.");
}
