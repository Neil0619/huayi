import type { SubmissionOutboxResponse } from "@huayi/store-domain";

export function renderPopupOutbox(
  outbox: SubmissionOutboxResponse | null,
  unavailable: boolean,
  busy: boolean,
  confirming: boolean,
): void {
  const row = document.querySelector<HTMLElement>(".outbox-row");
  const label = document.querySelector<HTMLElement>("[data-submission-outbox-state]");
  const retry = document.querySelector<HTMLButtonElement>("[data-submission-outbox-retry]");
  const clear = document.querySelector<HTMLButtonElement>("[data-submission-outbox-clear]");
  const actions = document.querySelector<HTMLElement>(".outbox-actions");
  const hasStored = outbox !== null && "count" in outbox && outbox.count > 0;
  if (row) row.hidden = !hasStored && !unavailable;
  if (label) {
    const count = hasStored ? `${outbox.count} 条` : "";
    label.textContent = unavailable
      ? "待上传状态读取失败，请重新打开弹窗。"
      : outbox?.state === "client-upgrade-required"
        ? `${count}待上传，请先更新语见。`
        : outbox?.state === "not-configured"
          ? `${count}保存在本机，此安装包不支持上传。`
          : `${count}待上传`;
    label.dataset.state = outbox?.state ?? "unavailable";
  }
  if (actions) actions.hidden = !hasStored;
  if (retry) retry.disabled = busy || outbox?.state !== "queued";
  if (clear) {
    clear.disabled = busy || !hasStored;
    clear.textContent = confirming ? "确认清空" : "清空";
  }
}
