import type { StoreAppearance } from "@huayi/store-domain";

const CAPTION_ACCENTS: Readonly<Record<StoreAppearance, string>> = {
  moon: "#a9b7c8",
  silver: "#d9e0e6",
  champagne: "#ddc4a7",
  porcelain: "#aab9df",
};

/** Both local and streamed subtitle controls use the same appearance palette. */
export function setSubtitleAppearance(
  elements: readonly HTMLElement[],
  appearance: StoreAppearance,
): void {
  for (const element of elements) {
    element.dataset.appearance = appearance;
    element.style.setProperty("--e", CAPTION_ACCENTS[appearance]);
  }
}
