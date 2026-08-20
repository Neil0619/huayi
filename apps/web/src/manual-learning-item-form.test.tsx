import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { contractFixtures, learningItemDetailResponseSchema } from "@huayi/cloud-contracts";

import { ManualLearningItemForm } from "./manual-learning-item-form.js";
import { WebLearningLibraryApiError } from "./learning-library-api.js";
import type { LearningLibraryApi } from "./learning-library-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view() {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: result.item,
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

function change(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function render(createLearningItem: LearningLibraryApi["createLearningItem"]) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () =>
    createRoot(container).render(
      <ManualLearningItemForm
        createLearningItem={createLearningItem}
        idempotencyKey={() => "manual-key-1"}
        onCreated={vi.fn(async () => undefined)}
      />,
    ),
  );
  return container;
}

async function fillExpression(container: Element) {
  for (const [name, value] of Object.entries({
    meaningZh: "坦率地说",
    text: "to be frank",
    usageZh: "用于直接表达意见。",
  })) {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[name='${name}']`,
    );
    if (input === null) throw new Error(`Missing ${name}.`);
    await act(async () => change(input, value));
  }
}

describe("manual learning item form", () => {
  beforeEach(() => document.body.replaceChildren());

  it("submits a strict expression and clears only after server refresh succeeds", async () => {
    const createLearningItem = vi.fn(async () => view());
    const container = await render(createLearningItem);
    for (const [name, value] of Object.entries({
      meaningZh: "坦率地说",
      systemAttributes: "spoken",
      tags: "Writing",
      text: "to be frank",
      usageZh: "用于直接表达意见。",
    })) {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name='${name}']`,
      );
      if (input === null) throw new Error(`Missing ${name}.`);
      await act(async () => change(input, value));
    }
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(createLearningItem).toHaveBeenCalledWith(
      {
        content: {
          meaningZh: "坦率地说",
          text: "to be frank",
          type: "expression",
          usageZh: "用于直接表达意见。",
        },
        systemAttributes: ["spoken"],
        tags: ["Writing"],
      },
      "manual-key-1",
    );
    expect(container.querySelector<HTMLInputElement>("[name='text']")?.value).toBe("");
  });

  it("supports declared sentence-pattern slots and preserves a duplicate draft", async () => {
    const createLearningItem = vi.fn<LearningLibraryApi["createLearningItem"]>(async () => {
      throw new WebLearningLibraryApiError("exact_duplicate");
    });
    const container = await render(createLearningItem);
    const type = container.querySelector<HTMLSelectElement>("[name='manualType']");
    if (type === null) throw new Error("Type missing.");
    await act(async () => change(type, "sentence-pattern"));
    for (const [name, value] of Object.entries({
      functionZh: "表达让步",
      slots: "clause: 分句内容",
      template: "Although {clause}, ...",
      usageZh: "用于引出让步关系。",
    })) {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name='${name}']`,
      );
      if (input === null) throw new Error(`Missing ${name}.`);
      await act(async () => change(input, value));
    }
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(createLearningItem).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          slots: [{ descriptionZh: "分句内容", name: "clause" }],
          type: "sentence_pattern",
        }),
      }),
      "manual-key-1",
    );
    expect(container.querySelector("[role='alert']")?.textContent).toContain("已存在完全相同");
    expect(container.querySelector<HTMLInputElement>("[name='template']")?.value).toBe(
      "Although {clause}, ...",
    );
  });

  it("reports refresh failure honestly after the server already created the item", async () => {
    const createLearningItem = vi.fn(async () => view());
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () =>
      createRoot(container).render(
        <ManualLearningItemForm
          createLearningItem={createLearningItem}
          idempotencyKey={() => "manual-key-1"}
          onCreated={vi.fn(async () => {
            throw new Error("refresh failed");
          })}
        />,
      ),
    );
    await fillExpression(container);
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "已经收录，但暂时无法刷新学习库",
    );
    expect(container.querySelector<HTMLInputElement>("[name='text']")?.value).toBe("to be frank");
  });
});
