import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionReview } from "./collection-review.js";
import { initialCandidateDrafts, type CandidateDraft } from "./candidate-editor.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";
import type { InboxApi } from "./inbox-app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
function fixture() {
  const analysis = nativeWebAnalysis();
  const api: InboxApi = {
    listPending: vi.fn(),
    getAnalysis: vi.fn(),
    processNothingToSave: vi.fn(),
    confirmCandidates: vi.fn(async () => ({
      analysis: { ...analysis, revision: 2, reviewState: "reviewed" as const },
      results: [],
    })),
  };
  return {
    analysis,
    api,
    draftCache: new Map<string, CandidateDraft[]>(),
    idempotencyKey: () => "offline-key",
    onSaved: vi.fn(),
  };
}
async function render(props: ReturnType<typeof fixture>) {
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () => root?.render(<CollectionReview {...props} />));
  return view;
}
it("starts every new candidate unselected", () => {
  expect(initialCandidateDrafts(nativeWebAnalysis()).every((draft) => !draft.selected)).toBe(true);
});
it("shows source-backed recommendations in server order and folds remaining candidates", async () => {
  const view = await render(fixture());
  const recommended = [...view.querySelectorAll("[data-recommendation]")];
  expect(recommended.map((node) => node.getAttribute("data-candidate-id"))).toEqual([
    "20000000-0000-4000-8000-000000000004",
    "20000000-0000-4000-8000-000000000002",
  ]);
  expect(view.querySelectorAll<HTMLInputElement>("input:checked")).toHaveLength(0);
  expect(view.querySelector<HTMLDetailsElement>("[data-remaining-candidates]")?.open).toBe(false);
  for (const node of recommended) {
    expect(node.querySelector<HTMLDetailsElement>("[data-recommendation-advice]")?.open).toBe(true);
    expect(node.textContent).toContain("原文依据");
    expect(node.textContent).toContain("生成示例");
  }
  expect(
    [...view.querySelectorAll("[data-core-fragment]")].map((node) => node.textContent),
  ).toEqual(["The café", "opens early", "We can meet there"]);
  expect(view.querySelector<HTMLDetailsElement>("[data-structure-modifiers]")?.open).toBe(false);
  expect(view.textContent).toContain("修饰主干 1");
});
it("keeps ID-owned edits and selected choices across recommendation order, refresh and failure", async () => {
  const f = fixture();
  const drafts = initialCandidateDrafts(f.analysis);
  const invalid = drafts[0],
    chosen = drafts[3];
  if (
    !invalid ||
    !chosen ||
    invalid.candidate.type !== "expression" ||
    chosen.candidate.type !== "expression"
  )
    throw new Error("fixture");
  invalid.selected = false;
  invalid.candidate.payload.text = "";
  chosen.selected = true;
  chosen.candidate.payload.text = "meet there later";
  chosen.tags = "friends";
  f.draftCache.set(f.analysis.id, drafts);
  vi.mocked(f.api.confirmCandidates).mockRejectedValueOnce(new Error("offline"));
  const view = await render(f);
  const form = view.querySelector("form");
  expect(form?.checkValidity()).toBe(true);
  await act(async () =>
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(f.api.confirmCandidates).toHaveBeenLastCalledWith(
    f.analysis.id,
    {
      analysisRevision: 1,
      confirmations: [
        expect.objectContaining({
          candidateId: chosen.candidate.id,
          payload: expect.objectContaining({ text: "meet there later" }),
          tags: ["friends"],
        }),
      ],
    },
    "offline-key",
  );
  expect(view.textContent).toContain("当前选择和编辑已保留");
  await act(async () =>
    root?.render(<CollectionReview {...f} analysis={{ ...f.analysis, revision: 2 }} />),
  );
  expect(
    view.querySelector<HTMLInputElement>(
      `[data-candidate-id="${chosen.candidate.id}"] input[data-candidate-selected]`,
    )?.checked,
  ).toBe(true);
  await act(async () =>
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(f.api.confirmCandidates).toHaveBeenLastCalledWith(
    f.analysis.id,
    expect.objectContaining({ analysisRevision: 2 }),
    "offline-key",
  );
});
