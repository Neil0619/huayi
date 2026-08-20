import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManualWordForm } from "./manual-word-form.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function change(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("manual word form", () => {
  beforeEach(() => document.body.replaceChildren());

  it("submits bounded manual fields and announces duplicate context honestly", async () => {
    const word = {
      canonicalKey: "run into",
      createdAt: "2026-08-13T01:00:00.000Z",
      headword: "run into",
      id: "word-1",
      notes: "existing",
      revision: 2,
      updatedAt: "2026-08-13T02:00:00.000Z",
    };
    const api = {
      upsertWord: vi.fn(async () => ({
        contextOutcome: "duplicate" as const,
        word,
        wordOutcome: "existing" as const,
      })),
    };
    const onSaved = vi.fn(async () => true);
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <ManualWordForm api={api} idempotencyKey={() => "upsert-1"} onSaved={onSaved} />,
      ),
    );
    const headword = container.querySelector<HTMLInputElement>("[name='headword']");
    const sourceText = container.querySelector<HTMLTextAreaElement>("[name='sourceText']");
    if (headword === null || sourceText === null) throw new Error("Expected manual word fields.");
    await change(headword, "run into");
    await change(sourceText, "I ran into her.");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(api.upsertWord).toHaveBeenCalledWith(
      { context: { sourceText: "I ran into her." }, headword: "run into" },
      "upsert-1",
    );
    expect(onSaved).toHaveBeenCalledWith("word-1");
    expect(container.querySelector("[role='status']")?.textContent).toContain("相同语境未重复添加");
  });

  it("retains the draft after write or refresh failure", async () => {
    const word = {
      canonicalKey: "make do",
      createdAt: "2026-08-13T01:00:00.000Z",
      headword: "make do",
      id: "word-2",
      revision: 1,
      updatedAt: "2026-08-13T01:00:00.000Z",
    };
    const api = {
      upsertWord: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
        contextOutcome: "omitted",
        word,
        wordOutcome: "created",
      }),
    };
    const onSaved = vi.fn(async () => false);
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <ManualWordForm api={api} idempotencyKey={() => "upsert-2"} onSaved={onSaved} />,
      ),
    );
    const headword = container.querySelector<HTMLInputElement>("[name='headword']");
    if (headword === null) throw new Error("Expected headword field.");
    await change(headword, "make do");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(container.querySelector("[role='alert']")?.textContent).toContain("草稿已保留");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "词条已收录，但刷新失败",
    );
    expect(headword.value).toBe("make do");
  });

  it("suppresses concurrent submits while the first write is pending", async () => {
    let resolve!: (value: {
      contextOutcome: "omitted";
      word: {
        canonicalKey: string;
        createdAt: string;
        headword: string;
        id: string;
        revision: number;
        updatedAt: string;
      };
      wordOutcome: "created";
    }) => void;
    const pending = new Promise<Parameters<typeof resolve>[0]>((done) => {
      resolve = done;
    });
    const api = { upsertWord: vi.fn(() => pending) };
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <ManualWordForm
          api={api}
          idempotencyKey={() => crypto.randomUUID()}
          onSaved={async () => true}
        />,
      ),
    );
    const headword = container.querySelector<HTMLInputElement>("[name='headword']");
    const form = container.querySelector<HTMLFormElement>("form");
    if (headword === null || form === null) throw new Error("Expected manual word form.");
    await change(headword, "hold forth");
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(api.upsertWord).toHaveBeenCalledOnce();
    await act(async () =>
      resolve({
        contextOutcome: "omitted",
        word: {
          canonicalKey: "hold forth",
          createdAt: "2026-08-13T00:00:00.000Z",
          headword: "hold forth",
          id: "word-3",
          revision: 1,
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
        wordOutcome: "created",
      }),
    );
  });
});
