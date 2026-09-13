import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PracticeHistoryDetail } from "./practice-history-detail.js";
import { practiceDate, teachingFixture } from "./practice-teaching.test-support.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
it("shows saved structured feedback and actual hint facts in history without a mutation", async () => {
  const teaching = teachingFixture(true);
  const api = { get: vi.fn(async () => teaching), act: vi.fn() };
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () =>
    root?.render(
      <PracticeHistoryDetail
        detail={{ session: teaching.session, completedAt: practiceDate, itemLabels: [] }}
        teachingApi={api}
      />,
    ),
  );
  expect(view.querySelector("[data-feedback-assessment=ready]")).not.toBeNull();
  expect(view.textContent).toContain("原作答");
  expect(view.textContent).toContain("本次未记录查看提示");
  expect(api.act).not.toHaveBeenCalled();
});
it("retains old text and does not invent hint facts for a legacy record", async () => {
  const teaching = teachingFixture(true);
  const view = document.createElement("div");
  document.body.append(view);
  root = createRoot(view);
  await act(async () =>
    root?.render(
      <PracticeHistoryDetail
        detail={{ session: teaching.session, completedAt: practiceDate, itemLabels: [] }}
      />,
    ),
  );
  expect(view.textContent).toContain("表达已经清楚");
  expect(view.textContent).toContain("旧记录未保存提示查看信息");
  expect(view.querySelector("[data-feedback-assessment]")).toBeNull();
});
