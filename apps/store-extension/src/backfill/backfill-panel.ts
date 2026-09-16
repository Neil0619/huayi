import type { BackfillMessage, BackfillView } from "./backfill-messages.js";
import { parseBackfillErrorCode, parseBackfillView } from "./backfill-view-parser.js";
import { BackfillError, backfillErrorResponse } from "./backfill-errors.js";

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  return element;
}
export function initializeBackfillPanel(options: {
  container: HTMLElement;
  sendMessage: (message: unknown) => Promise<unknown>;
  subscribe?: (changed: () => void) => () => void;
  subscribeProgress?: (changed: () => void) => () => void;
  confirm?: (text: string) => boolean;
}) {
  const section = node("section");
  section.setAttribute("aria-label", "扇贝回填");
  section.dataset.backfillPanel = "";
  const heading = node("h2", "扇贝回填");
  heading.className = "section-label";
  const summary = node("p");
  summary.setAttribute("role", "status");
  const checked = node("p");
  checked.className = "field-help";
  const actions = node("div");
  actions.className = "outbox-actions";
  const notes = node(
    "p",
    "首次检查包含欧路默认生词本的已有词。检查在后台进行；每批最多 100 个词由你在扇贝点击添加。",
  );
  notes.className = "field-help";
  const error = node("p");
  error.setAttribute("role", "alert");
  section.append(heading, summary, checked, actions, notes, error);
  options.container.append(section);
  let current: BackfillView | null = null;
  let busy = false;
  let reading = false;
  let disposed = false;
  let generation = 0;
  let refreshPending = false;
  let viewRevision = 0;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  const confirm = options.confirm ?? ((text) => window.confirm(text));
  type PanelRequest = BackfillMessage extends infer Message
    ? Message extends { expectedScope: string }
      ? Omit<Message, "expectedScope">
      : Message
    : never;
  const request = async (message: PanelRequest) => {
    const revision = generation;
    const scoped =
      message.type === "store/backfill-status" || message.type === "store/backfill-initialize"
        ? message
        : { ...message, expectedScope: current?.status.scopeId };
    const response = await (message.type === "store/backfill-status"
      ? readWithDeadline(() => options.sendMessage(scoped))
      : options.sendMessage(scoped));
    if (revision !== generation || disposed) throw new Error("Account changed.");
    if (typeof response === "object" && response !== null && "error" in response) {
      throw new BackfillError(parseBackfillErrorCode(response));
    }
    return response;
  };
  const button = (label: string, work: () => Promise<void>) => {
    const control = node("button", label);
    control.type = "button";
    control.className = "text-button";
    control.disabled = busy;
    control.addEventListener("click", () => {
      void execute(work);
    });
    return control;
  };
  const render = () => {
    if (disposed) return;
    actions.replaceChildren();
    if (!current) {
      summary.textContent = reading ? "正在获取已保存的回填状态…" : "暂时无法读取回填状态";
      checked.textContent = "";
      if (!reading && !busy) actions.append(button("重试", refresh));
      return;
    }
    if (current.initializing) {
      summary.textContent = current.checkError
        ? "暂时无法获取账号回填状态"
        : "正在后台获取回填状态…";
      checked.textContent = "首次连接需要获取账号状态，其他功能可正常使用。";
      error.textContent = current.checkError ?? "";
      actions.append(
        button(current.checkError ? "重试" : "刷新状态", async () => {
          current = parseBackfillView(await request({ type: "store/backfill-initialize" }));
        }),
      );
      return;
    }
    const status = current.status;
    const ready = status.enabled && !current.needsLocalMerge;
    summary.textContent = current.reconnectRequired
      ? "本机进度已共享，请连接原账号后继续。"
      : ready
        ? `待回填 ${status.pendingCount} · 需处理 ${status.unresolvedCount}${status.unknownCount ? ` · 待确认 ${status.unknownCount}` : ""}`
        : current.needsLocalMerge
          ? "此设备尚未开启共享回填"
          : "尚未开启";
    checked.textContent = current.lastCheckedAt
      ? `最近检查：${new Date(current.lastCheckedAt).toLocaleString()}`
      : "尚未检查";
    if (current.incomplete) checked.textContent += " · 欧路达到分页上限，本次检查不完整";
    if (current.checkError) checked.textContent += ` · ${current.checkError}`;
    if (current.checking) checked.textContent += " · 后台检查中，数量会继续更新";
    if (current.reconnectRequired) return;
    if (!ready)
      actions.append(
        button("开启扇贝回填", async () => {
          if (
            !confirm(
              (current?.localMergeBlocked
                ? "原账号的本机历史将保留在原账号；当前账号从云端、欧路及此后新增的本机词开始检查。\n\n"
                : "") +
                "开启扇贝回填？\n\n检查欧路、本机收藏和云端生词，首次包含已有词。关联账号后，仅上传欧路/本机词头和回填进度以跨设备共享，不会因此加入云端学习库。各设备须使用同一个扇贝账号。\n\n欧路默认每天 08:00 检查，云端每 15 分钟刷新。扇贝每批仍由你亲自点击添加。",
            )
          )
            return;
          current = parseBackfillView(
            await request({
              type: "store/backfill-enable",
              enabled: true,
              shareLocal: !current?.localMergeBlocked,
            }),
          );
        }),
      );
    else {
      const check = button(current.checking ? "正在后台检查…" : "检查新词", async () => {
        current = parseBackfillView(await request({ type: "store/backfill-check" }));
      });
      check.disabled = busy || current.checking;
      actions.append(
        check,
        button("打开扇贝回填", async () => {
          current = parseBackfillView(await request({ type: "store/backfill-open" }));
        }),
      );
      const attentionCount = status.unresolvedCount + status.unknownCount;
      const attention = button(attentionCount > 0 ? "需处理" : "需处理 (0)", async () => {
        current = parseBackfillView(await request({ type: "store/backfill-open", view: "review" }));
      });
      attention.disabled = busy || attentionCount === 0;
      actions.append(attention);
      actions.append(
        button("停用", async () => {
          current = parseBackfillView(
            await request({ type: "store/backfill-enable", enabled: false, shareLocal: false }),
          );
        }),
      );
    }
  };
  const execute = async (work: () => Promise<void>) => {
    if (busy || disposed) return;
    busy = true;
    viewRevision += 1;
    if (reading) refreshPending = true;
    const revision = generation;
    error.textContent = "";
    render();
    try {
      await work();
    } catch (failure) {
      if (revision !== generation || disposed) return;
      if (failure instanceof BackfillError && failure.code === "authentication") current = null;
      error.textContent = backfillErrorResponse(failure).error;
    } finally {
      busy = false;
      render();
      if (refreshPending && !disposed) {
        refreshPending = false;
        void refresh();
      }
    }
  };
  const refresh = async () => {
    if (disposed) return;
    if (reading || busy) {
      refreshPending = true;
      return;
    }
    reading = true;
    const identity = generation;
    const revision = viewRevision;
    render();
    try {
      const state = parseBackfillView(await request({ type: "store/backfill-status" }));
      if (revision === viewRevision) {
        current = state;
        error.textContent = "";
      }
    } catch (failure) {
      if (identity === generation && revision === viewRevision && !disposed) {
        if (failure instanceof BackfillError && failure.code === "authentication") current = null;
        error.textContent = backfillErrorResponse(failure).error;
      }
    } finally {
      reading = false;
      render();
      if (refreshPending && !busy && !disposed) {
        refreshPending = false;
        void refresh();
      }
    }
  };
  const unsubscribe = options.subscribe?.(() => {
    generation += 1;
    viewRevision += 1;
    current = null;
    error.textContent = "";
    actions.replaceChildren();
    void refresh();
    render();
  });
  const unsubscribeProgress = options.subscribeProgress?.(() => {
    if (disposed || progressTimer !== undefined) return;
    progressTimer = setTimeout(() => {
      progressTimer = undefined;
      void refresh();
    }, 50);
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    refreshPending = false;
    clearTimeout(progressTimer);
    unsubscribe?.();
    unsubscribeProgress?.();
    section.remove();
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("pagehide", dispose, { once: true });
  void refresh();
  return { refresh, dispose };
}

async function readWithDeadline(work: () => Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BackfillError("connection")), 3_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
