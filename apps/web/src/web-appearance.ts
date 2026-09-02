export const WEB_APPEARANCES = ["moon", "silver", "champagne", "porcelain"] as const;

export type WebAppearance = (typeof WEB_APPEARANCES)[number];

export const DEFAULT_WEB_APPEARANCE: WebAppearance = "silver";
export const WEB_APPEARANCE_STORAGE_KEY = "huayi.web.appearance.v1";

export interface WebAppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseWebAppearance(value: string | null): WebAppearance | undefined {
  return WEB_APPEARANCES.find((appearance) => appearance === value);
}

export function getWebAppearanceStorage(): WebAppearanceStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readWebAppearance(
  storage: Pick<WebAppearanceStorage, "getItem"> | undefined = getWebAppearanceStorage(),
): WebAppearance {
  try {
    return (
      parseWebAppearance(storage?.getItem(WEB_APPEARANCE_STORAGE_KEY) ?? null) ??
      DEFAULT_WEB_APPEARANCE
    );
  } catch {
    return DEFAULT_WEB_APPEARANCE;
  }
}

export function applyWebAppearance(
  root: Pick<HTMLElement, "dataset">,
  appearance: WebAppearance,
): void {
  root.dataset.appearance = appearance;
}

export function initializeWebAppearance(
  root: Pick<HTMLElement, "dataset">,
  storage?: Pick<WebAppearanceStorage, "getItem"> | undefined,
): WebAppearance {
  const appearance = readWebAppearance(storage);
  applyWebAppearance(root, appearance);
  return appearance;
}

export function writeWebAppearance(
  storage: Pick<WebAppearanceStorage, "setItem"> | undefined,
  appearance: WebAppearance,
): boolean {
  try {
    if (storage === undefined) return false;
    storage.setItem(WEB_APPEARANCE_STORAGE_KEY, appearance);
    return true;
  } catch {
    return false;
  }
}
