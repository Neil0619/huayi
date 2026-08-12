import type { CaptionBridge, CapturedCaptionTrack } from "./youtube-bridge-client.js";

export async function captureTranslatedCaption(
  bridge: CaptionBridge,
  expectedVideoId: string,
  generation: number,
  isCurrent: () => boolean,
  waitForRetry: () => Promise<void>,
): Promise<CapturedCaptionTrack | null> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const translated = await bridge.capture({
      expectedVideoId,
      generation,
      target: "translated",
    });
    if (!isCurrent() || translated !== null) return translated;
    if (attempt < 2) await waitForRetry();
    if (!isCurrent()) return null;
  }
  return null;
}

export function waitForTranslatedCaptionRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
}
