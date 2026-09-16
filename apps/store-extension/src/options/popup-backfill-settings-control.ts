import {
  observePopupBackfillPreference,
  savePopupBackfillPreference,
  type PopupBackfillPreferenceStorage,
} from "../page-ui/popup-backfill-preference.js";

export function initializePopupBackfillSettings(
  document: Document,
  storage: PopupBackfillPreferenceStorage,
) {
  const input = document.querySelector<HTMLInputElement>("[data-popup-backfill-visible]");
  const status = document.querySelector<HTMLElement>("[data-popup-backfill-status]");
  if (!input || !status) return;
  let confirmed = false;
  let known = false;
  let saving = false;
  let disposed = false;
  const render = () => {
    input.checked = confirmed;
    input.disabled = !known || saving;
  };
  render();
  const preference = observePopupBackfillPreference(
    storage,
    (visible) => {
      confirmed = visible;
      known = true;
      status.textContent = "";
      render();
    },
    () => {
      known = false;
      status.textContent = "无法读取弹窗显示设置，请重新打开设置页。";
      render();
    },
  );
  const save = async () => {
    if (disposed || saving || !known) return;
    const visible = input.checked;
    saving = true;
    input.disabled = true;
    status.textContent = "正在保存…";
    let failed = false;
    try {
      await savePopupBackfillPreference(storage, visible);
    } catch {
      failed = true;
    }
    if (disposed) return;
    // Reconcile both successful and failed writes with storage, preserving newer events.
    await preference.refresh();
    if (disposed) return;
    saving = false;
    if (failed)
      status.textContent = known
        ? "保存失败，已恢复当前已保存设置，请重试。"
        : "保存失败，且无法确认当前设置，请重新打开设置页。";
    else if (known)
      status.textContent = confirmed
        ? "已显示弹窗中的扇贝回填卡片。"
        : "已隐藏弹窗中的扇贝回填卡片。";
    render();
  };
  const onChange = () => void save();
  input.addEventListener("change", onChange);
  const dispose = () => {
    disposed = true;
    preference.dispose();
    input.removeEventListener("change", onChange);
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("pagehide", dispose, { once: true });
  return { dispose };
}
