import {
  batchContainerSelector,
  batchScope,
  compactText,
  feedbackElements,
  feedbackHasExplicitFailure,
  feedbackHasExplicitSuccess,
  findBatchTextarea,
  rejectedWordsFromFeedback,
  visible,
} from "./shanbay-page-adapter.js";

/** A receipt belongs to the textarea and dialog present at the user's submit gesture. */
export class ShanbaySubmissionFeedback {
  private readonly baseline: Map<HTMLElement, string>;
  private readonly scope: HTMLElement;
  constructor(readonly input: HTMLTextAreaElement) {
    this.scope = batchScope(input);
    // Include hidden existing nodes: revealing an old message is not a new receipt.
    this.baseline = new Map(this.elements().map((node) => [node, compactText(node)]));
  }

  private elements(): HTMLElement[] {
    return feedbackElements(this.scope).filter(
      (node) => node.closest(batchContainerSelector) === this.scope.closest(batchContainerSelector),
    );
  }

  read(expectedWords: readonly string[], edited: boolean): { rejected: readonly string[] } | null {
    if (
      !this.scope.isConnected ||
      findBatchTextarea(this.input.ownerDocument) !== this.input ||
      batchScope(this.input) !== this.scope
    )
      return null;
    const elements = this.elements();
    const fresh = elements
      .filter(visible)
      .filter((node) => !this.baseline.has(node) || this.baseline.get(node) !== compactText(node));
    // A reused node may transition through Pending before returning the same completion count.
    for (const node of fresh) {
      const text = compactText(node);
      if (!feedbackHasExplicitFailure([text]) && !/添加完成|添加成功|导入成功/u.test(text))
        this.baseline.set(node, text);
    }
    const terminal = fresh.filter((node) => {
      const text = compactText(node);
      return feedbackHasExplicitFailure([text]) || /添加完成|添加成功|导入成功/u.test(text);
    });
    if (terminal.length !== 1) return null;
    const node = terminal[0];
    if (!node) return null;
    const text = compactText(node);
    if (feedbackHasExplicitFailure([text])) {
      if (edited) return null;
      const rejected = rejectedWordsFromFeedback(text, this.input, expectedWords);
      return rejected ? { rejected } : null;
    }
    if (node.closest('[class*="warning"], [class*="error"], [class*="fail"]')) return null;
    return feedbackHasExplicitSuccess([text], expectedWords.length) ? { rejected: [] } : null;
  }
}
