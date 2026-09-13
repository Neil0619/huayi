import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CollectionAnalysisTabs } from "./collection-analysis-tabs.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";
import { change, click, render, setup } from "./study-inbox.test-support.js";

async function workspace() {
  const analysis = nativeWebAnalysis();
  const fixture = setup(
    { listCaptures: vi.fn(async () => ({ items: [], nextCursor: null })) },
    { listPending: vi.fn(async () => ({ items: [analysis], nextCursor: null })) },
  );
  return { view: await render(fixture), fixture, analysis };
}

it("opens translation when analysis completes without a visible structured preview", async () => {
  const view = document.createElement("div");
  document.body.append(view);
  const root = createRoot(view);
  try {
    await act(async () =>
      root.render(
        <CollectionAnalysisTabs analysis={undefined} units={[]}>
          {null}
        </CollectionAnalysisTabs>,
      ),
    );
    expect(view.querySelector('[role="tablist"]')).toBeNull();
    const analysis = nativeWebAnalysis();
    const units =
      analysis.result.type === "sentence-passage-analysis-v3" ? analysis.result.sentences : [];
    await act(async () =>
      root.render(
        <CollectionAnalysisTabs analysis={analysis} units={units}>
          {null}
        </CollectionAnalysisTabs>,
      ),
    );
    expect(
      view.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-label"),
    ).toBe("译文");
  } finally {
    await act(async () => root.unmount());
    view.remove();
  }
});

it("shows only translation initially and places all native teaching and choices inside tabs", async () => {
  const { view } = await workspace();
  const tabs = [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [...view.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
    "译文",
    "深度解析",
    "学习内容",
  ]);
  expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
  tabs.forEach((tab, index) => {
    expect(tab.getAttribute("aria-controls")).toBe(panels[index]?.id);
    expect(panels[index]?.getAttribute("aria-labelledby")).toBe(tab.id);
  });
  expect(view.querySelector("[data-native-unit]")?.closest('[role="tabpanel"]')).toBe(panels[1]);
  expect(view.querySelector(".collection-review")?.closest('[role="tabpanel"]')).toBe(panels[2]);
  await click(view, '[role="tab"][aria-label="学习内容"]');
  expect(panels.map((panel) => panel.hidden)).toEqual([true, true, false]);
  expect(view.querySelector(".recommendation-evidence")).toBeNull();
  expect(view.textContent).not.toContain("以下引用对应分析时的原始候选");
  expect(view.querySelector<HTMLDetailsElement>("[data-recommendation-advice]")?.open).toBe(false);
  expect(
    view.querySelector(".collection-candidate .analysis-teaching-example")?.closest("details"),
  ).toBeNull();
});

it("supports roving keyboard focus without submitting or reloading analysis", async () => {
  const { view, fixture } = await workspace();
  const tabs = [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs).toHaveLength(3);
  tabs[0]?.focus();
  for (const [key, index] of [
    ["End", 2],
    ["ArrowRight", 0],
    ["ArrowRight", 1],
    ["Home", 0],
  ] as const) {
    await act(async () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
    );
    expect(document.activeElement).toBe(tabs[index]);
    expect(tabs[index]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  }
  expect(fixture.review.confirmCandidates).not.toHaveBeenCalled();
  expect(fixture.review.getAnalysis).not.toHaveBeenCalled();
});

it("preserves selection, edits and the exact editor DOM across tab switches", async () => {
  const { view, fixture, analysis } = await workspace();
  await click(view, '[role="tab"][aria-label="学习内容"]');
  const candidate = view.querySelector<HTMLElement>("[data-recommendation]");
  if (!candidate) throw new Error("Missing recommended candidate");
  await click(candidate, "[data-candidate-selected]");
  const editor = candidate.querySelector<HTMLDetailsElement>("details:last-child");
  if (!editor) throw new Error("Missing editor");
  await act(async () => {
    editor.open = true;
  });
  const input = candidate.querySelector<HTMLInputElement>('fieldset input:not([type="checkbox"])');
  await change(candidate, 'fieldset input:not([type="checkbox"])', "meet there later");
  await click(view, '[role="tab"][aria-label="译文"]');
  await click(view, '[role="tab"][aria-label="学习内容"]');
  expect(candidate.querySelector('fieldset input:not([type="checkbox"])')).toBe(input);
  expect(input?.value).toBe("meet there later");
  expect(editor.open).toBe(true);
  expect(candidate.querySelector<HTMLInputElement>("[data-candidate-selected]")?.checked).toBe(
    true,
  );
  const form = candidate.closest("form");
  await act(async () =>
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(fixture.review.confirmCandidates).toHaveBeenCalledWith(
    analysis.id,
    {
      analysisRevision: 1,
      confirmations: [
        expect.objectContaining({
          candidateId: candidate.dataset.candidateId,
          payload: expect.objectContaining({ text: "meet there later" }),
        }),
      ],
    },
    "write-key",
  );
  expect(JSON.stringify(vi.mocked(fixture.review.confirmCandidates).mock.calls)).not.toContain(
    "sourceEvidence",
  );
});
