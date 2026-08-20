import { normalizeSelectionText } from "@huayi/store-domain";

import type { StoreSelectionReading } from "../selection/read-selection.js";

export function applyYouTubeSelectionBoundary(
  reading: StoreSelectionReading,
  subtitleText: string,
): StoreSelectionReading {
  if (reading.selection !== normalizeSelectionText(subtitleText)) return reading;
  return {
    ...reading,
    boundaryEvidence: { kind: "youtube-subtitle-sentence" },
    selectionKind: "sentence",
  };
}
