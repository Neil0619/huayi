import { englishWordSchema } from "@huayi/protocol";

export function normalizedText(element: Element): string {
  const label =
    element.textContent || element.getAttribute("value") || element.getAttribute("aria-label");
  return (label ?? "").replaceAll(/\s+/gu, "").trim();
}

function isUsable(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style === undefined || (style.display !== "none" && style.visibility !== "hidden");
}

export function findUniqueByText(document: Document, text: string): HTMLElement | null {
  const matches = [
    ...document.querySelectorAll<HTMLElement>('button, [role="button"], input, a, div, span'),
  ].filter((element) => isUsable(element) && normalizedText(element) === text);
  const deepest = matches.filter(
    (element) =>
      ![...element.children].some((child) => isUsable(child) && normalizedText(child) === text),
  );
  return deepest.length === 1 ? (deepest[0] ?? null) : null;
}

export function findBatchTextarea(document: Document): HTMLTextAreaElement | null {
  const textareas = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].filter(
    isUsable,
  );
  const matching = textareas.filter((textarea) => {
    const placeholder = textarea.getAttribute("placeholder") ?? "";
    const containerText = normalizedText(
      textarea.closest('[role="dialog"]') ?? textarea.parentElement ?? textarea,
    );
    return placeholder.includes("需要添加的单词") || containerText.includes("批量添加到生词本");
  });
  return matching.length === 1 ? (matching[0] ?? null) : null;
}

export function visibleFeedback(document: Document): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="status"], [role="alert"], [class*="toast"], [class*="message"], ' +
        '[class*="error"], [class*="fail"]',
    ),
  ]
    .filter(isUsable)
    .map(normalizedText)
    .filter((text) => text.length > 0);
}

export function isExplicitSuccess(text: string): boolean {
  const normalized = text.replaceAll(/\s+/gu, "");
  const completed = [...normalized.matchAll(/添加完成[（(](\d{1,3})\/(\d{1,3})[）)]/gu)].some(
    (match) => {
      const completedCount = Number(match[1]);
      const totalCount = Number(match[2]);
      return completedCount > 0 && completedCount === totalCount;
    },
  );
  return (
    completed ||
    ((normalized.includes("添加成功") || normalized.includes("导入成功")) &&
      !normalized.includes("失败") &&
      !normalized.includes("部分") &&
      !normalized.includes("未添加"))
  );
}

export function isExplicitFailure(text: string): boolean {
  return ["失败", "部分", "未添加", "未能成功添加"].some((term) => text.includes(term));
}

export function pageHasExplicitFailure(document: Document): boolean {
  return normalizedText(document.body).includes("未能成功添加");
}

export function pageHasFullCountCompletion(document: Document, expectedCount: number): boolean {
  return [
    ...document.querySelectorAll<HTMLElement>("div, span, p, [role='status'], [role='alert']"),
  ]
    .filter(isUsable)
    .map(normalizedText)
    .some((text) =>
      [...text.matchAll(/添加完成[（(](\d{1,3})\/(\d{1,3})[）)]/gu)].some((match) => {
        const completedCount = Number(match[1]);
        const totalCount = Number(match[2]);
        return completedCount === expectedCount && totalCount === expectedCount;
      }),
    );
}

function normalizeWord(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("’", "'");
}

export function normalizeTextareaValue(value: string): string {
  return value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export function batchFailureSignature(document: Document): string | null {
  const text = normalizedText(document.body);
  const matches = [...text.matchAll(/有(\d{1,3})个单词未能成功添加/gu)];
  const match = matches.at(-1);
  const textarea = findBatchTextarea(document);
  if (match === undefined && !visibleFeedback(document).some(isExplicitFailure)) return null;
  return `${match?.[0] ?? "failure"}\u0000${textarea?.value ?? ""}`;
}

export interface RejectedBatchResult {
  rejectedTargets: string[];
  textarea: HTMLTextAreaElement;
}

export function readRejectedBatchResult(
  document: Document,
  batchTargets: readonly string[],
): RejectedBatchResult | null {
  const text = normalizedText(document.body);
  const matches = [...text.matchAll(/有(\d{1,3})个单词未能成功添加/gu)];
  const countText = matches.at(-1)?.[1];
  const count = countText === undefined ? Number.NaN : Number(countText);
  const textarea = findBatchTextarea(document);
  if (!Number.isInteger(count) || count < 1 || textarea === null) return null;

  const targetByKey = new Map(batchTargets.map((word) => [normalizeWord(word), word] as const));
  const rejectedTargets: string[] = [];
  const seen = new Set<string>();
  for (const line of textarea.value.split(/\r?\n/gu)) {
    if (line.trim().length === 0) continue;
    const parsed = englishWordSchema.safeParse(line);
    if (!parsed.success) return null;
    const key = normalizeWord(parsed.data);
    const target = targetByKey.get(key);
    if (target === undefined || seen.has(key)) return null;
    seen.add(key);
    rejectedTargets.push(target);
  }
  if (rejectedTargets.length !== count) return null;
  return { rejectedTargets, textarea };
}
