import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { learningTaskSnapshotSchema, type PracticeReferenceDetail } from "@huayi/cloud-contracts";
import { practiceDate, teachingFixture } from "./practice-teaching.test-support.js";
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
const example = {
  sentence: "To be frank, I think we should simplify this plan.",
  translationZh: "坦白说，我觉得我们应该简化这个方案。",
  usageNoteZh: "用 to be frank 引出自己的真实想法。",
};
function fixture(initial = teachingFixture()) {
  const f = teachingPageFixture(initial);
  let ready = false;
  let viewed = false;
  const read = (): PracticeReferenceDetail => ({
    version: 1,
    sessionId: f.current().session.id,
    revision: f.current().session.revision,
    controlRevision: f.current().session.workspace?.controlRevision ?? 0,
    ordinal: f.current().teaching?.round.ordinal ?? 0,
    availability: "available",
    ready,
    viewedAt: viewed ? practiceDate : null,
    reference: viewed ? example : null,
  });
  f.api.reference = {
    get: vi.fn(async () => read()),
    reveal: vi.fn(async (_id, input, key) => {
      await f.teaching.act(f.current().session.id, { action: "reveal-hint", ...input }, key);
      viewed = true;
      return read();
    }),
  };
  const snapshot = learningTaskSnapshotSchema.parse({
    version: 2,
    id: "reference-task",
    kind: "sentence-reference",
    subjectId: f.current().session.id,
    state: "queued",
    cursor: 0,
    timings: {},
    createdAt: practiceDate,
    updatedAt: practiceDate,
    output: null,
    error: null,
  });
  f.api.tasks = {
    submit: vi.fn(async () => snapshot),
    list: vi.fn(async () => []),
    get: vi.fn(async () => snapshot),
    cancel: vi.fn(async () => snapshot),
    async *watch() {
      ready = true;
      yield { type: "practice.updated" as const, session: f.current().session };
    },
  };
  return {
    ...f,
    ready() {
      ready = true;
    },
    reference: f.api.reference,
    tasks: f.api.tasks,
  };
}
it("generates only on demand, reveals an example without filling or submitting the draft, and reopens without another generation", async () => {
  const f = fixture();
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "继续上次练习");
  expect(f.tasks.submit).not.toHaveBeenCalled();
  expect(rendered.view.textContent).not.toContain(example.sentence);
  await typeAnswer(rendered.view, "My own start");
  await press(rendered.view, "查看参考表达");
  expect(rendered.view.textContent).toContain(example.sentence);
  expect(rendered.view.textContent).toContain(example.translationZh);
  expect(rendered.view.querySelector<HTMLTextAreaElement>("[name=answer]")?.value).toBe(
    "My own start",
  );
  expect(f.current().teaching?.round.hintViewedAt).toBe(practiceDate);
  expect(f.api.submitAttempt).not.toHaveBeenCalled();
  expect(f.api.rate).not.toHaveBeenCalled();
  expect(f.tasks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "sentence-reference",
      input: { expectedRevision: 2, expectedControlRevision: 0, ordinal: 0 },
    }),
    expect.any(String),
    expect.any(AbortSignal),
  );
  await press(rendered.view, "收起参考表达");
  expect(rendered.view.textContent).not.toContain(example.sentence);
  await press(rendered.view, "查看参考表达");
  expect(rendered.view.textContent).toContain(example.sentence);
  expect(f.tasks.submit).toHaveBeenCalledTimes(1);
});
it("retries a lost submission with the same command and idempotency key", async () => {
  const f = fixture();
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "继续上次练习");
  vi.mocked(f.tasks.submit).mockRejectedValueOnce(new TypeError("Response lost"));
  await press(rendered.view, "查看参考表达");
  expect(rendered.view.textContent).not.toContain(example.sentence);
  await press(rendered.view, "重试查看参考表达");
  expect(vi.mocked(f.tasks.submit).mock.calls[1]?.slice(0, 2)).toEqual(
    vi.mocked(f.tasks.submit).mock.calls[0]?.slice(0, 2),
  );
  expect(rendered.view.textContent).toContain(example.sentence);
});

it("reveals an existing saved reference after re-entry without generating again", async () => {
  const f = fixture();
  f.ready();
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "继续上次练习");
  expect(rendered.view.textContent).not.toContain(example.sentence);
  await press(rendered.view, "查看参考表达");
  expect(rendered.view.textContent).toContain(example.sentence);
  expect(f.tasks.submit).not.toHaveBeenCalled();
});

it("can pause and resume while a submission is interrupted, without revealing a late result", async () => {
  const f = fixture();
  const snapshot = await f.tasks.get("reference-task");
  let resolve: (value: typeof snapshot) => void = () => undefined;
  vi.mocked(f.tasks.submit).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "继续上次练习");
  await press(rendered.view, "查看参考表达");
  await typeAnswer(rendered.view, "Still my draft");
  await press(rendered.view, "暂停练习");
  await press(rendered.view, "继续上次练习");
  await act(async () => resolve(snapshot));
  expect(f.reference.reveal).not.toHaveBeenCalled();
  await press(rendered.view, "查看参考表达");
  expect(rendered.view.textContent).toContain(example.sentence);
  expect(rendered.view.querySelector<HTMLTextAreaElement>("[name=answer]")?.value).toBe(
    "Still my draft",
  );
});

it("synchronizes saved hint and revision after a committed reveal reply is lost", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    const reveal = vi.mocked(f.reference.reveal).getMockImplementation();
    if (!reveal) throw new Error("Missing reveal fixture.");
    vi.mocked(f.reference.reveal).mockImplementationOnce(async (...args) => {
      await reveal(...args);
      throw new TypeError("Reply lost after commit");
    });
    const rendered = await renderPractice(f.api);
    root = rendered.root;
    await press(rendered.view, "继续上次练习");
    await typeAnswer(rendered.view, "My saved draft");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await press(rendered.view, "查看参考表达");
    await press(rendered.view, "重试查看参考表达");
    expect(rendered.view.textContent).toContain(example.sentence);
    expect(rendered.view.querySelector(".practice-hint-fact")?.textContent).toBe(
      "本轮已记录查看提示。",
    );
    expect(f.tasks.submit).toHaveBeenCalledTimes(1);
    expect(f.reference.reveal).toHaveBeenCalledTimes(1);
    await press(rendered.view, "提交并获取反馈");
    expect(vi.mocked(f.tasks.submit).mock.calls.at(-1)?.[0]).toMatchObject({
      kind: "sentence-submit",
      input: { answer: "My saved draft", expectedRevision: f.current().session.revision },
    });
  } finally {
    vi.useRealTimers();
  }
});

it("focuses a new rewrite but keeps the reference button focused through a same-round reread", async () => {
  const f = fixture(teachingFixture(true));
  f.ready();
  const rendered = await renderPractice(f.api);
  root = rendered.root;
  await press(rendered.view, "查看反馈并自评");
  await press(rendered.view, "我再写一句");
  const input = rendered.view.querySelector<HTMLTextAreaElement>("[name=answer]");
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  const referenceButton = findButton(rendered.view, "查看参考表达");
  referenceButton.focus();
  await press(rendered.view, "查看参考表达");
  expect(rendered.view.textContent).toContain(example.sentence);
  expect(f.reference.reveal).toHaveBeenCalledWith(
    "teaching-session",
    expect.objectContaining({ ordinal: 1 }),
    expect.any(String),
  );
  expect(document.activeElement).toBe(referenceButton);
  expect(f.tasks.submit).not.toHaveBeenCalled();
});
