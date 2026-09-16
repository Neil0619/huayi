export function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"], [inert]'))
    return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(current);
    if (style && (style.display === "none" || ["hidden", "collapse"].includes(style.visibility)))
      return false;
  }
  return true;
}

function usable(element: HTMLElement): boolean {
  if (!visible(element) || element.closest('[disabled], [aria-disabled="true"]')) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if ([...current.classList].some((name) => /(?:^|_)disabled(?:_|$)/iu.test(name))) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.pointerEvents === "none" || style?.opacity === "0") return false;
  }
  return true;
}

export function compactText(element: Element): string {
  return (element.textContent ?? "").replaceAll(/\s+/gu, "").trim();
}

export const batchContainerSelector = 'dialog, [role="dialog"], [class*="index_container__"]';

export function batchScope(textarea: HTMLTextAreaElement): HTMLElement {
  return (
    textarea.closest<HTMLElement>(batchContainerSelector) ??
    textarea.parentElement ??
    textarea.ownerDocument.body
  );
}

export function findUniqueButton(
  document: Document,
  text: string,
  scope: ParentNode = document,
): HTMLElement | null {
  const actual = text === "批量上传" ? '[class*="batchUploadBtn"]' : '[class*="index_submit__"]';
  const matches = [...scope.querySelectorAll<HTMLElement>(`button, [role="button"], ${actual}`)]
    .filter((element) => usable(element) && compactText(element) === text)
    .filter(
      (element) =>
        scope === document ||
        element.closest(batchContainerSelector) ===
          (scope instanceof (document.defaultView?.Element ?? Element)
            ? scope.closest(batchContainerSelector)
            : null),
    );
  // Nested labels belong to one control, but two independent controls are ambiguous.
  const outermost = matches.filter(
    (element) => !matches.some((other) => other !== element && other.contains(element)),
  );
  return outermost.length === 1 ? (outermost[0] ?? null) : null;
}

export function findBatchTextarea(document: Document): HTMLTextAreaElement | null {
  const matches = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].filter(
    (textarea) =>
      usable(textarea) &&
      (textarea.placeholder.includes("需要添加的单词") ||
        compactText(batchScope(textarea)).includes("批量添加到生词本")),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function setBatchTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const window = textarea.ownerDocument.defaultView;
  const setter = Object.getOwnPropertyDescriptor(
    window?.HTMLTextAreaElement.prototype ?? Object.prototype,
    "value",
  )?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  const eventConstructor = window?.Event ?? Event;
  textarea.dispatchEvent(new eventConstructor("input", { bubbles: true }));
  textarea.dispatchEvent(new eventConstructor("change", { bubbles: true }));
}

export function normalizeBatchText(value: string): string {
  return value
    .split(/\r?\n/gu)
    .map((line) => line.trim().toLocaleLowerCase("en-US").replaceAll("’", "'"))
    .filter((line) => line.length > 0)
    .join("\n");
}

export function rejectedWordsFromFeedback(
  feedback: string,
  textarea: HTMLTextAreaElement,
  expectedWords: readonly string[],
): readonly string[] | null {
  const count = Number(/^有(\d{1,3})个单词未能成功添加$/u.exec(feedback)?.[1] ?? Number.NaN);
  if (!Number.isSafeInteger(count) || count < 1 || count > expectedWords.length) return null;
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

export function readRejectedWords(
  document: Document,
  expectedWords: readonly string[],
): readonly string[] | null {
  const textarea = findBatchTextarea(document);
  if (!textarea) return null;
  const failures = [...resultFeedback(document)].filter((text) =>
    /^有\d{1,3}个单词未能成功添加$/u.test(text),
  );
  return failures.length === 1
    ? rejectedWordsFromFeedback(failures[0] ?? "", textarea, expectedWords)
    : null;
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
  if (feedbackHasExplicitFailure(messages)) return false;
  return messages.some((text) => {
    if (text === "添加成功" || text === "导入成功") return true;
    const match = /^添加完成[（(](\d{1,3})\/(\d{1,3})[）)]$/u.exec(text);
    return Number(match?.[1]) === expectedCount && Number(match?.[2]) === expectedCount;
  });
}

const feedbackSelector =
  '[role="status"], [role="alert"], [class*="toast"], [class*="message"], ' +
  '[class*="error"], [class*="fail"], [class*="index_msg__"], [class*="index_warning__"]';

export function feedbackElements(scope: ParentNode): HTMLElement[] {
  const elements = [...scope.querySelectorAll<HTMLElement>(feedbackSelector)].filter(
    (element) => !element.closest("[data-huayi-backfill], [data-huayi-store-shanbay]"),
  );
  return elements.filter(
    (element) =>
      !elements.some(
        (other) =>
          other !== element &&
          element.contains(other) &&
          compactText(element) === compactText(other),
      ),
  );
}

export function resultFeedback(document: Document): ReadonlySet<string> {
  return new Set(feedbackElements(document).filter(visible).map(compactText).filter(Boolean));
}
