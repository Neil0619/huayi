import { englishWordSchema, type WordSyncUnresolvedListEvent } from "@huayi/protocol";

export interface ShanbayUnresolvedPanelOptions {
  document: Document;
  event: WordSyncUnresolvedListEvent;
  onDiscard(sourceWords: string[]): void;
  onDiscardAll(): void;
  onPage(offset: number): void;
  onRequeue(items: { sourceWord: string; targetWord: string }[]): void;
}

const reasonLabels = {
  "ambiguous-lemma": "存在多个可能的原形",
  "no-lemma": "未找到可靠原形",
  "shanbay-rejected-lemma": "扇贝仍拒绝还原后的词",
  "shanbay-rejected-manual": "扇贝仍拒绝人工替代词",
} as const;

async function copyText(document: Document, value: string): Promise<void> {
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard !== undefined) {
    await clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function appendUnresolvedPanel(
  bar: HTMLElement,
  options: ShanbayUnresolvedPanelOptions,
): void {
  const { document, event } = options;
  const feedback = document.createElement("div");
  feedback.setAttribute("aria-live", "polite");
  const list = document.createElement("div");
  list.className = "unresolved";
  const setBusy = (): void => {
    for (const control of bar.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      "button, input",
    )) {
      control.disabled = true;
    }
  };
  for (const item of event.items) {
    const row = document.createElement("div");
    row.className = "unresolved-row";
    const source = document.createElement("span");
    source.textContent = item.sourceWord;
    const replacement = document.createElement("div");
    replacement.className = "replacement-controls";
    const input = document.createElement("input");
    input.setAttribute("aria-label", `${item.sourceWord} 的替代词`);
    input.autocomplete = "off";
    input.dataset.sourceWord = item.sourceWord;
    input.placeholder = "输入替代词";
    input.type = "text";
    const discard = document.createElement("button");
    discard.className = "danger compact";
    discard.dataset.sourceWord = item.sourceWord;
    discard.title = `放弃 ${item.sourceWord}`;
    discard.type = "button";
    discard.textContent = "放弃";
    discard.addEventListener("click", () => {
      setBusy();
      feedback.textContent = `正在放弃 ${item.sourceWord}……`;
      options.onDiscard([item.sourceWord]);
    });
    replacement.append(input, discard);
    const detail = document.createElement("small");
    const candidates = item.candidates.length === 0 ? "" : `；候选：${item.candidates.join("、")}`;
    detail.textContent = `${reasonLabels[item.reason]}；上次尝试：${item.lastTargetWord}${candidates}`;
    row.append(source, replacement, detail);
    list.append(row);
  }
  bar.append(list);

  bar.append(feedback);

  const actions = document.createElement("div");
  actions.className = "actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "复制本页";
  copy.addEventListener("click", () => {
    const text = event.items
      .map((item) => `${item.sourceWord}\t${item.lastTargetWord}\t${reasonLabels[item.reason]}`)
      .join("\n");
    void copyText(document, text).then(
      () => {
        feedback.textContent = "已复制本页未解决词。";
      },
      () => {
        feedback.textContent = "复制失败，请直接选择列表文字复制。";
      },
    );
  });
  const requeue = document.createElement("button");
  requeue.className = "primary";
  requeue.type = "button";
  requeue.textContent = "重新入队";
  requeue.addEventListener("click", () => {
    const replacements = [...list.querySelectorAll<HTMLInputElement>("input")]
      .map((input) => ({
        sourceWord: input.dataset.sourceWord ?? "",
        targetWord: input.value.trim(),
      }))
      .filter((item) => item.targetWord.length > 0);
    if (replacements.length === 0) {
      feedback.textContent = "请至少输入一个替代词。";
      return;
    }
    if (replacements.some((item) => !englishWordSchema.safeParse(item.targetWord).success)) {
      feedback.textContent = "替代词必须是一个合法的英语词头。";
      return;
    }
    options.onRequeue(replacements);
    setBusy();
    feedback.textContent = "正在重新入队……";
  });
  const discardAll = document.createElement("button");
  discardAll.className = "danger";
  discardAll.type = "button";
  discardAll.textContent = `全部放弃（${event.totalCount}）`;
  let discardAllArmed = false;
  discardAll.addEventListener("click", () => {
    if (!discardAllArmed) {
      discardAllArmed = true;
      discardAll.textContent = `确认全部放弃（${event.totalCount}）`;
      feedback.textContent = "请再次点击确认；放弃后，这些词不会再次自动同步。";
      return;
    }
    setBusy();
    feedback.textContent = `正在放弃全部 ${event.totalCount} 个未解决词……`;
    options.onDiscardAll();
  });
  actions.append(copy, requeue, discardAll);

  if (event.offset > 0) {
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "上一页";
    previous.addEventListener("click", () => options.onPage(Math.max(0, event.offset - 100)));
    actions.prepend(previous);
  }
  if (event.offset + event.items.length < event.totalCount) {
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "下一页";
    next.addEventListener("click", () => options.onPage(event.offset + event.items.length));
    actions.append(next);
  }
  bar.append(actions);
}
