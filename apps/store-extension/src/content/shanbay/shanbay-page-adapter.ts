function visible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]') !== null) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style === undefined || (style.display !== "none" && style.visibility !== "hidden");
}

export function compactText(element: Element): string {
  return (element.textContent ?? "").replaceAll(/\s+/gu, "").trim();
}

export function findUniqueButton(document: Document, text: string): HTMLElement | null {
  const matches = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(
    (element) => visible(element) && compactText(element) === text,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function findBatchTextarea(document: Document): HTMLTextAreaElement | null {
  const matches = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].filter(
    (textarea) => {
      if (!visible(textarea)) return false;
      const placeholder = textarea.placeholder;
      const container = textarea.closest('[role="dialog"]') ?? textarea.parentElement;
      return (
        placeholder.includes("需要添加的单词") ||
        (container !== null && compactText(container).includes("批量添加到生词本"))
      );
    },
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function normalizeBatchText(value: string): string {
  return value
    .split(/\r?\n/gu)
    .map((line) => line.trim().toLocaleLowerCase("en-US").replaceAll("’", "'"))
    .filter((line) => line.length > 0)
    .join("\n");
}

export function readRejectedWords(
  document: Document,
  expectedWords: readonly string[],
): readonly string[] | null {
  const feedback = compactText(document.body);
  const matches = [...feedback.matchAll(/有(\d{1,3})个单词未能成功添加/gu)];
  const count = Number(matches.at(-1)?.[1] ?? Number.NaN);
  const textarea = findBatchTextarea(document);
  if (!Number.isSafeInteger(count) || count < 1 || textarea === null) return null;
  const expected = new Map(expectedWords.map((word) => [normalizeBatchText(word), word] as const));
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const line of textarea.value.split(/\r?\n/gu)) {
    const key = normalizeBatchText(line);
    if (key.length === 0) continue;
    const word = expected.get(key);
    if (word === undefined || seen.has(key)) return null;
    seen.add(key);
    rejected.push(word);
  }
  return rejected.length === count ? rejected : null;
}

export function feedbackHasExplicitFailure(messages: readonly string[]): boolean {
  return messages.some((text) =>
    ["失败", "部分", "未添加", "未能成功添加"].some((term) => text.includes(term)),
  );
}

export function feedbackHasExplicitSuccess(
  messages: readonly string[],
  expectedCount: number,
): boolean {
  return messages.some((text) => {
    if (["失败", "部分", "未添加"].some((term) => text.includes(term))) return false;
    if (text.includes("添加成功") || text.includes("导入成功")) return true;
    return [...text.matchAll(/添加完成[（(](\d{1,3})\/(\d{1,3})[）)]/gu)].some(
      (match) => Number(match[1]) === expectedCount && Number(match[2]) === expectedCount,
    );
  });
}

export function resultFeedback(document: Document): ReadonlySet<string> {
  return new Set(
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="status"], [role="alert"], [class*="toast"], [class*="message"], [class*="error"], [class*="fail"]',
      ),
    ]
      .filter(visible)
      .map(compactText)
      .filter((text) => text.length > 0),
  );
}
