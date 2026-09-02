import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AppearanceSelector, appearanceLabels } from "./appearance-selector.js";
import {
  DEFAULT_WEB_APPEARANCE,
  WEB_APPEARANCE_STORAGE_KEY,
  applyWebAppearance,
  getWebAppearanceStorage,
  parseWebAppearance,
  readWebAppearance,
  writeWebAppearance,
  type WebAppearance,
} from "./web-appearance.js";

export function WebAppearanceController({ children }: { readonly children: ReactNode }) {
  const [storage] = useState(getWebAppearanceStorage);
  const [appearance, setAppearance] = useState<WebAppearance>(() => readWebAppearance(storage));
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    applyWebAppearance(document.documentElement, appearance);
  }, [appearance]);

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key !== WEB_APPEARANCE_STORAGE_KEY) return;
      if (event.storageArea !== null && event.storageArea !== storage) return;
      const synchronizedAppearance = parseWebAppearance(event.newValue) ?? DEFAULT_WEB_APPEARANCE;
      applyWebAppearance(document.documentElement, synchronizedAppearance);
      setAppearance(synchronizedAppearance);
      setSaveMessage("");
    };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, [storage]);

  const selectAppearance = useCallback(
    (selected: WebAppearance) => {
      applyWebAppearance(document.documentElement, selected);
      setAppearance(selected);
      setSaveMessage(writeWebAppearance(storage, selected) ? "" : "本次有效，未能保存");
    },
    [storage],
  );

  return (
    <>
      <details className="appearance-menu">
        <summary>外观 · {appearanceLabels[appearance]}</summary>
        <AppearanceSelector onChange={selectAppearance} value={appearance} />
      </details>
      {children}
      <p aria-atomic="true" aria-live="polite" className="appearance-save-status">
        {saveMessage}
      </p>
    </>
  );
}
