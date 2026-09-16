import type { BackfillPageReviewResponse } from "../../backfill/backfill-messages.js";
export function renderBackfillReviewRows(options: {
  document: Document;
  view: BackfillPageReviewResponse;
  drafts: Map<string, string>;
  button: (text: string, work: () => Promise<void>) => HTMLButtonElement;
  replace: (alias: string, source: string, input: HTMLInputElement) => Promise<void>;
  discard: (alias: string, source: string) => Promise<void>;
  retryUnknown: (alias: string) => Promise<void>;
  discardUnknown: (alias: string) => Promise<void>;
}): HTMLElement[] {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
    const element = options.document.createElement(tag);
    element.textContent = text;
    return element;
  };
  const rows: HTMLElement[] = [];
  for (const source of options.view.items) {
    const row = node("div");
    row.className = "row";
    row.dataset.reviewAlias = source.alias;
    row.dataset.reviewKind = "source";
    const label = node("label", source.headword);
    const detail = node("p", source.explanation);
    detail.className = "explanation";
    const input = node("input");
    input.value = options.drafts.get(source.headword) ?? source.target;
    input.setAttribute("aria-label", `${source.headword} 的回填目标`);
    input.addEventListener("input", () => options.drafts.set(source.headword, input.value));
    label.append(input);
    const candidates = node("div");
    candidates.className = "row-actions";
    for (const candidate of source.candidates)
      candidates.append(
        options.button(`使用 ${candidate}`, async () => {
          input.value = candidate;
          options.drafts.set(source.headword, candidate);
          input.focus();
        }),
      );
    const actions = node("div");
    actions.className = "row-actions";
    actions.append(
      options.button("修改并重试", () => options.replace(source.alias, source.headword, input)),
      options.button("跳过", () => options.discard(source.alias, source.headword)),
    );
    const progress = node("p");
    progress.className = "row-progress";
    progress.setAttribute("role", "status");
    row.append(detail, label, candidates, actions, progress);
    rows.push(row);
  }
  for (const batch of options.view.unknownBatches) {
    const row = node("div");
    row.className = "row";
    row.dataset.reviewAlias = batch.alias;
    row.dataset.reviewKind = "unknown";
    const progress = node("p");
    progress.className = "row-progress";
    progress.setAttribute("role", "status");
    const words = node("details");
    words.append(
      node("summary", `查看 ${batch.headwords.length} 个词`),
      node("p", batch.headwords.join("、")),
    );
    const actions = node("div");
    actions.className = "row-actions";
    actions.append(
      options.button("不再提醒", () => options.discardUnknown(batch.alias)),
      options.button("核对后重试", () => options.retryUnknown(batch.alias)),
    );
    row.append(node("p", `结果待确认 · ${batch.headwords.length} 个词`), words, actions, progress);
    rows.push(row);
  }
  if (!rows.length && options.view.unresolvedCount + options.view.unknownCount > 0)
    rows.push(node("p", "本页没有需处理的词。"));
  return rows;
}
