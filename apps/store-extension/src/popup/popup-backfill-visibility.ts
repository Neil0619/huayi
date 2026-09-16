import { initializeBackfillPanel } from "../backfill/backfill-panel.js";
import {
  observePopupBackfillPreference,
  type PopupBackfillPreferenceStorage,
} from "../page-ui/popup-backfill-preference.js";

export function initializePopupBackfill(
  options: Parameters<typeof initializeBackfillPanel>[0] & {
    storage: PopupBackfillPreferenceStorage;
  },
) {
  let panel: ReturnType<typeof initializeBackfillPanel> | undefined;
  const error = options.container.ownerDocument.createElement("p");
  error.setAttribute("role", "alert");
  error.className = "field-help";
  const hide = () => {
    panel?.dispose();
    panel = undefined;
  };
  const preference = observePopupBackfillPreference(
    options.storage,
    (visible) => {
      error.remove();
      if (visible) panel ??= initializeBackfillPanel(options);
      else hide();
    },
    () => {
      hide();
      error.textContent = "无法读取弹窗显示设置，扇贝回填卡片暂时隐藏。请重新打开弹窗。";
      options.container.append(error);
    },
  );
  const dispose = () => {
    preference.dispose();
    hide();
    error.remove();
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("pagehide", dispose, { once: true });
  return { dispose };
}
