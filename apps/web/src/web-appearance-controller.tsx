import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

const AppearanceMenuContext = createContext<{
  readonly setTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

export function WorkspaceAppearanceMenu() {
  const context = useContext(AppearanceMenuContext);
  return <div className="workspace-appearance" ref={context?.setTarget} />;
}

export function WebAppearanceController({ children }: { readonly children: ReactNode }) {
  const [storage] = useState(getWebAppearanceStorage);
  const [appearance, setAppearance] = useState<WebAppearance>(() => readWebAppearance(storage));
  const [saveMessage, setSaveMessage] = useState("");
  const [menuTarget, setMenuTarget] = useState<HTMLDivElement | null>(null);

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

  const menu = (
    <details
      className="appearance-menu"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary>外观 · {appearanceLabels[appearance]}</summary>
      <AppearanceSelector onChange={selectAppearance} value={appearance} />
    </details>
  );
  return (
    <AppearanceMenuContext.Provider value={{ setTarget: setMenuTarget }}>
      {menuTarget === null ? menu : createPortal(menu, menuTarget)}
      {children}
      <p aria-atomic="true" aria-live="polite" className="appearance-save-status">
        {saveMessage}
      </p>
    </AppearanceMenuContext.Provider>
  );
}
