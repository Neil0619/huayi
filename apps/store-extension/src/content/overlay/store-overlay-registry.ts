import { StoreOverlayController, type StoreOverlayRuntime } from "./store-overlay-controller.js";

interface OverlayRegistryEntry {
  readonly document: Document;
  readonly overlay: StoreOverlayController;
}

const OVERLAY_REGISTRY_KEY = Symbol.for("@huayi/store-extension/overlay");

export function getOrCreateStoreOverlay(
  document: Document,
  runtime: StoreOverlayRuntime,
): StoreOverlayController {
  const existing = Reflect.get(globalThis, OVERLAY_REGISTRY_KEY) as
    OverlayRegistryEntry | undefined;
  if (existing?.document === document) return existing.overlay;

  const overlay = new StoreOverlayController(document, runtime);
  Reflect.set(globalThis, OVERLAY_REGISTRY_KEY, { document, overlay });
  return overlay;
}
