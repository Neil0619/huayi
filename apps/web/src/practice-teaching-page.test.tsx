import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { practiceDate, practiceTarget, teachingFixture } from "./practice-teaching.test-support.js";
import {
  findButton,
  press,
  renderPractice,
  teachingPageFixture,
  typeAnswer,
} from "./practice-teaching-page.test-support.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/practice");
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

it("opens a saved on-demand round without exposing English and reveals only after the saved action", async () => {
  const f = teachingPageFixture();
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "继续上次练习");
  const panel = rendered.view.querySelector(".practice-session");
  expect(panel?.textContent).not.toContain("to be frank");
  expect(panel?.textContent).toContain("和同事讨论方案");
  await press(rendered.view, "查看英文提示");
  expect(panel?.textContent).toContain("to be frank");
  expect(f.teaching.act).toHaveBeenCalledWith(
    "teaching-session",
    { action: "reveal-hint", expectedRevision: 2, expectedControlRevision: 0, ordinal: 0 },
    expect.any(String),
  );
  expect(f.api.submitAttempt).not.toHaveBeenCalled();
});

it("opts into teaching and hides chooser English when on-demand practice is selected", async () => {
  const f = teachingPageFixture();
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  const checkbox = rendered.view.querySelector<HTMLInputElement>("[data-hint-policy]");
  expect(checkbox).not.toBeNull();
  await act(async () => checkbox?.click());
  expect(rendered.view.querySelector(".practice-items")?.textContent).not.toContain("to be frank");
  await press(rendered.view, "开始今日练习");
  expect(f.workspace.start).toHaveBeenCalledWith(
    expect.objectContaining({
      teachingContract: "practice-teaching-v1",
      hintPolicy: "on-demand",
      mode: "guided",
    }),
    expect.any(String),
  );
});

it("shows one ready point, saved answer history, and a rewrite prefill without advancing a rating", async () => {
  const detail = teachingFixture(true);
  const f = teachingPageFixture(detail);
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "查看反馈并自评");
  expect(rendered.view.textContent).toContain("表达已经清楚");
  expect(rendered.view.querySelector("[data-feedback-assessment=ready]")).not.toBeNull();
  await press(rendered.view, "我再写一句");
  expect(rendered.view.querySelector<HTMLTextAreaElement>("[name=answer]")?.value).toBe(
    detail.session.attempts?.[0]?.answer,
  );
  expect(f.current().session.attempts).toEqual(detail.session.attempts);
  expect(f.api.rate).not.toHaveBeenCalled();
  expect(f.api.submitAttempt).not.toHaveBeenCalled();
});

it("keeps saved feedback when teaching read fails and offers only a GET retry", async () => {
  const f = teachingPageFixture(teachingFixture(true));
  vi.mocked(f.teaching.get).mockRejectedValueOnce(new Error("Offline sidecar"));
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "查看反馈并自评");
  expect(rendered.view.textContent).toContain("表达已经清楚");
  expect(rendered.view.textContent).toContain("重新读取练习详情");
  await press(rendered.view, "重新读取练习详情");
  expect(rendered.view.querySelector("[data-feedback-assessment=ready]")).not.toBeNull();
  expect(f.teaching.act).not.toHaveBeenCalled();
  expect(f.api.retryFeedback).not.toHaveBeenCalled();
});

it("retains a rated rewrite in the resume list and controls with the local draft version", async () => {
  const detail = teachingFixture();
  detail.session.items = detail.session.items.map((item) => ({
    ...item,
    rating: "mastered",
    scheduleAfter: { consecutiveMastered: 1, dueAt: "2026-09-15T00:00:00.000Z", level: 0 },
  }));
  const f = teachingPageFixture(detail);
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "继续上次练习");
  await typeAnswer(rendered.view, "A retained rewrite.");
  await press(rendered.view, "暂停练习");
  expect(f.workspace.control).toHaveBeenCalledWith(
    "teaching-session",
    expect.objectContaining({ expectedDraftRevision: 0, draft: "A retained rewrite." }),
    expect.any(String),
  );
  await expect(vi.mocked(f.workspace.control).mock.results[0]?.value).resolves.toMatchObject({
    workspace: { phase: "paused" },
  });
  expect(findButton(rendered.view, "继续上次练习")).toBeDefined();
});

it("does not restore deleted target information from a stale queue or library detail", async () => {
  const before = teachingFixture(true);
  const f = teachingPageFixture(before);
  vi.mocked(f.workspace.list).mockResolvedValue([before.session]);
  vi.mocked(f.workspace.get).mockResolvedValue(before.session);
  f.save({
    ...before,
    session: {
      ...before.session,
      revision: before.session.revision + 1,
      items: before.session.items.map((item) => ({
        ...item,
        learningItemDeletedAt: practiceDate,
        rating: "mastered",
        scheduleAfter: { consecutiveMastered: 1, dueAt: "2026-09-15T00:00:00.000Z", level: 0 },
      })),
    },
    teaching: {
      ...before.teaching,
      target: {
        state: "deleted",
        itemId: practiceTarget.item.id,
        capturedAt: practiceDate,
        deletedAt: practiceDate,
      },
    },
  });
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "查看反馈并自评");
  const panel = rendered.view.querySelector(".practice-session");
  expect(panel?.querySelector("h2")?.textContent).toBe("学习项已删除");
  expect(panel?.textContent).not.toContain("意思是");
  expect(panel?.textContent).not.toContain("来源例句");
  expect(panel?.textContent).not.toContain("我再写一句");
  expect(panel?.textContent).toContain(before.session.attempts?.[0]?.answer);
  expect(panel?.textContent).toContain("表达已经清楚");
});
