import { describe, expect, it, vi } from "vitest";

import type { ActionsOverlayState } from "./overlay-state.js";
import { renderToolbar } from "./render-toolbar.js";

function actionsState(
  selectionKind: ActionsOverlayState["selection"]["selectionKind"],
  selection = "investigation",
): ActionsOverlayState {
  return {
    anchorRect: { bottom: 20, height: 10, left: 10, right: 30, top: 10, width: 20 },
    selection: {
      context: selection,
      selection,
      selectionKind,
      sentenceContext: selectionKind === "word" || selectionKind === "phrase" ? selection : null,
      wordbookContext: selectionKind === "word" ? selection : null,
    },
    status: "actions",
  };
}

describe("renderToolbar", () => {
  it("presents the selected text above hierarchical explain and translate action cards", () => {
    const onAction = vi.fn();
    const toolbar = renderToolbar(actionsState("word"), { onAction });
    const selection = toolbar.querySelector(".huayi-toolbar-selection-text");
    const actions = toolbar.querySelectorAll<HTMLButtonElement>(".huayi-action");

    expect(selection?.textContent).toBe("investigation");
    expect(actions).toHaveLength(2);
    expect(actions[0]?.dataset.action).toBe("explain");
    expect(actions[0]?.dataset.emphasis).toBe("primary");
    expect(actions[0]?.querySelector(".huayi-action-description")?.textContent).toContain("原句");
    expect(actions[1]?.dataset.action).toBe("translate");
    expect(actions[1]?.dataset.emphasis).toBe("secondary");
    expect(actions[1]?.querySelector(".huayi-action-description")?.textContent).toContain("释义");

    actions[0]?.click();
    actions[1]?.click();
    expect(onAction.mock.calls).toEqual([["explain"], ["translate"]]);
  });

  it.each([
    ["phrase", ["explain", "translate"]],
    ["sentence", ["explain", "translate"]],
    ["paragraph", ["translate"]],
  ] as const)("uses the supported action policy for %s", (selectionKind, expectedActions) => {
    const toolbar = renderToolbar(actionsState(selectionKind), { onAction: () => undefined });

    expect(
      Array.from(
        toolbar.querySelectorAll<HTMLButtonElement>(".huayi-action"),
        (button) => button.dataset.action,
      ),
    ).toEqual(expectedActions);
    expect(toolbar.querySelector<HTMLButtonElement>(".huayi-action")?.dataset.emphasis).toBe(
      "primary",
    );
  });

  it("keeps sentence explanation available with a structure-specific description", () => {
    const toolbar = renderToolbar(actionsState("sentence"), { onAction: () => undefined });

    expect(
      toolbar.querySelector('[data-action="explain"] .huayi-action-description')?.textContent,
    ).toContain("句子结构");
  });

  it("renders hostile selected text without creating page-supplied elements", () => {
    const hostile = '<img src=x onerror="globalThis.pwned=true">';
    const toolbar = renderToolbar(actionsState("phrase", hostile), {
      onAction: () => undefined,
    });

    expect(toolbar.querySelector("img")).toBeNull();
    expect(toolbar.querySelector(".huayi-toolbar-selection-text")?.textContent).toBe(hostile);
  });
});
