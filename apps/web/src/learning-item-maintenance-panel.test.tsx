import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  contractFixtures,
  learningItemDetailResponseSchema,
  type DeleteLearningItemResponse,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";

import { LearningItemMaintenancePanel } from "./learning-item-maintenance-panel.js";
import type { LearningLibraryApi } from "./learning-library-api-port.js";
import { WebLearningLibraryApiError } from "./learning-library-api.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view(id = "item-1", revision = 1): LearningItemDetailResponse {
  const result = contractFixtures.confirmCandidatesResponse.results[0];
  if (result.type !== "learning-item") throw new Error("Learning item fixture missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: { ...result.item, id, revision },
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

type MaintenanceApi = Pick<
  LearningLibraryApi,
  | "archiveLearningItem"
  | "confirmLearningItemMerge"
  | "deleteLearningItem"
  | "patchLearningItem"
  | "previewLearningItemMerge"
  | "restoreLearningItem"
  | "suggestLearningItemDuplicates"
>;

function api(overrides: Partial<MaintenanceApi> = {}): MaintenanceApi {
  return {
    archiveLearningItem: vi.fn(async () => ({
      ...view("item-1", 2),
      archivedAt: "2026-08-14T03:00:00.000Z",
    })),
    confirmLearningItemMerge: vi.fn(async () => ({
      deletedSourceId: "item-1",
      target: view("item-2", 2),
    })),
    deleteLearningItem: vi.fn(async (id) => ({
      deleted: true as const,
      deletionKind: "hard-delete" as const,
      id,
    })),
    patchLearningItem: vi.fn(async () => view("item-1", 2)),
    previewLearningItemMerge: vi.fn(async () => ({
      allowed: true,
      blockedReason: null,
      scheduleDecision: "keep-target" as const,
      source: view(),
      target: view("item-2"),
    })),
    restoreLearningItem: vi.fn(async () => view("item-1", 2)),
    suggestLearningItemDuplicates: vi.fn(async () => ({
      itemRevision: 1,
      suggestions: [
        {
          candidate: view("item-2"),
          confidence: 0.8,
          reasonZh: "语义用途相近。",
        },
      ],
    })),
    ...overrides,
  };
}

async function render(
  maintenanceApi: MaintenanceApi,
  callbacks: {
    detail?: LearningItemDetailResponse;
    idempotencyKey?: () => string;
    onDeleted?: (response: DeleteLearningItemResponse) => Promise<void>;
    onUpdated?: (detail: LearningItemDetailResponse, status: string) => Promise<void>;
  } = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDeleted = vi.fn(callbacks.onDeleted ?? (async () => undefined));
  const onUpdated = vi.fn(callbacks.onUpdated ?? (async () => undefined));
  await act(async () =>
    root.render(
      <LearningItemMaintenancePanel
        api={maintenanceApi}
        detail={callbacks.detail ?? view()}
        idempotencyKey={callbacks.idempotencyKey ?? (() => "write-1")}
        onDeleted={onDeleted}
        onUpdated={onUpdated}
      />,
    ),
  );
  return { container, onDeleted, onUpdated, root };
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("learning item maintenance panel", () => {
  beforeEach(() => document.body.replaceChildren());

  it("keeps an edited draft and explains an exact duplicate conflict", async () => {
    const maintenanceApi = api({
      patchLearningItem: vi.fn(async () => {
        throw new WebLearningLibraryApiError("exact_duplicate");
      }),
    });
    const { container } = await render(maintenanceApi);
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    const input = container.querySelector<HTMLInputElement>("[name='editText']");
    if (input === null) throw new Error("Edit input missing.");
    await act(async () => setValue(input, "frankly"));
    await act(async () =>
      container.querySelector<HTMLFormElement>(".library-edit-form")?.requestSubmit(),
    );
    expect(container.querySelector("[role='alert']")?.textContent).toContain("完全相同");
    expect(input.value).toBe("frankly");
    expect(maintenanceApi.patchLearningItem).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ content: expect.objectContaining({ text: "frankly" }) }),
      "write-1",
    );
  });

  it("requires a focused second confirmation before delete", async () => {
    const maintenanceApi = api();
    const { container, onDeleted } = await render(maintenanceApi);
    const remove = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "删除学习项",
    );
    await act(async () => remove?.click());
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "确认删除",
    );
    expect(confirm).toBe(document.activeElement);
    expect(maintenanceApi.deleteLearningItem).not.toHaveBeenCalled();
    await act(async () => confirm?.click());
    expect(maintenanceApi.deleteLearningItem).toHaveBeenCalledWith(
      "item-1",
      { expectedRevision: 1 },
      "write-1",
    );
    expect(onDeleted).toHaveBeenCalledWith({
      deleted: true,
      deletionKind: "hard-delete",
      id: "item-1",
    });
  });

  it("uses an irreversible erasure warning for an archived practiced item", async () => {
    const archived = {
      ...view("item-1", 2),
      archivedAt: "2026-08-14T03:00:00.000Z",
      hasPracticeHistory: true,
      recentPractice: {
        completedAt: "2026-08-14T02:00:00.000Z",
        rating: "mastered" as const,
        sessionId: "session-1",
        type: "sentence-creation" as const,
      },
    };
    const maintenanceApi = api({
      deleteLearningItem: vi.fn(async (id) => ({
        deleted: true as const,
        deletionKind: "erased" as const,
        id,
      })),
    });
    const { container, onDeleted } = await render(maintenanceApi, { detail: archived });
    const remove = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "永久删除学习项",
    );
    await act(async () => remove?.click());
    expect(container.textContent).toContain("既有练习题、作答、对话和反馈会保留");
    expect(container.textContent).toContain("相同内容以后重建会成为全新学习项");
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "确认永久删除",
    );
    await act(async () => confirm?.click());
    expect(onDeleted).toHaveBeenCalledWith({
      deleted: true,
      deletionKind: "erased",
      id: "item-1",
    });
  });

  it("hydrates suggestion, previews, and explicitly confirms a safe merge", async () => {
    const maintenanceApi = api();
    const { container, onUpdated } = await render(maintenanceApi);
    const button = (text: string) =>
      Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === text);
    await act(async () => button("查找语义重复")?.click());
    expect(maintenanceApi.suggestLearningItemDuplicates).toHaveBeenCalledWith(
      "item-1",
      { expectedRevision: 1 },
      "write-1",
    );
    expect(container.textContent).toContain("语义用途相近");
    await act(async () => button("预览合并")?.click());
    expect(container.textContent).toContain("保留目标学习项的正文与排期");
    await act(async () => button("确认合并并删除来源")?.click());
    expect(maintenanceApi.confirmLearningItemMerge).toHaveBeenCalledWith(
      "item-1",
      { sourceRevision: 1, targetItemId: "item-2", targetRevision: 1 },
      "write-1",
    );
    expect(onUpdated).toHaveBeenCalledWith(
      view("item-2", 2),
      expect.stringContaining("来源学习项已删除"),
    );
  });

  it("keeps the detail and prior suggestions after failure, then retries only on a new click and key", async () => {
    const suggestLearningItemDuplicates = vi
      .fn<MaintenanceApi["suggestLearningItemDuplicates"]>()
      .mockResolvedValueOnce({
        itemRevision: 1,
        suggestions: [{ candidate: view("item-2"), confidence: 0.8, reasonZh: "先前的候选。" }],
      })
      .mockRejectedValueOnce(new WebLearningLibraryApiError("model_unavailable"));
    const keys = ["suggest-1", "suggest-2"];
    const idempotencyKey = vi.fn(() => keys.shift() ?? "unexpected-key");
    const maintenanceApi = api({ suggestLearningItemDuplicates });
    const { container } = await render(maintenanceApi, { idempotencyKey });
    const suggest = () =>
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "查找语义重复",
      );

    await act(async () => suggest()?.click());
    expect(container.textContent).toContain("先前的候选");
    await act(async () => suggest()?.click());

    expect(suggestLearningItemDuplicates).toHaveBeenNthCalledWith(
      1,
      "item-1",
      { expectedRevision: 1 },
      "suggest-1",
    );
    expect(suggestLearningItemDuplicates).toHaveBeenNthCalledWith(
      2,
      "item-1",
      { expectedRevision: 1 },
      "suggest-2",
    );
    expect(suggestLearningItemDuplicates).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("to be frank");
    expect(container.textContent).toContain("先前的候选");
    expect(container.querySelector("[role='alert']")?.textContent).toContain("暂时不可用");
  });

  it.each([
    ["quota_exhausted", "额度已用完"],
    ["generation_busy", "仍在处理中"],
    ["model_output_invalid", "结果无效"],
  ] as const)("keeps the detail for the stable suggestion error %s", async (code, copy) => {
    const maintenanceApi = api({
      suggestLearningItemDuplicates: vi.fn(async () => {
        throw new WebLearningLibraryApiError(code);
      }),
    });
    const { container } = await render(maintenanceApi);
    const suggest = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "查找语义重复",
    );
    await act(async () => suggest?.click());
    expect(suggest).toBeInstanceOf(HTMLButtonElement);
    expect(container.contains(suggest ?? null)).toBe(true);
    expect(container.querySelector("[role='alert']")?.textContent).toContain(copy);
    expect(maintenanceApi.suggestLearningItemDuplicates).toHaveBeenCalledOnce();
  });

  it("suppresses a suggestion response after selection changes", async () => {
    let resolve!: (
      value: Awaited<ReturnType<MaintenanceApi["suggestLearningItemDuplicates"]>>,
    ) => void;
    const response = new Promise<
      Awaited<ReturnType<MaintenanceApi["suggestLearningItemDuplicates"]>>
    >((onResolve) => {
      resolve = onResolve;
    });
    const maintenanceApi = api({ suggestLearningItemDuplicates: vi.fn(() => response) });
    const { container, root } = await render(maintenanceApi);
    const suggest = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "查找语义重复",
    );
    await act(async () => suggest?.click());
    await act(async () =>
      root.render(
        <LearningItemMaintenancePanel
          api={maintenanceApi}
          detail={view("item-3")}
          idempotencyKey={() => "write-1"}
          onDeleted={async () => undefined}
          onUpdated={async () => undefined}
        />,
      ),
    );
    await act(async () =>
      resolve({
        itemRevision: 1,
        suggestions: [{ candidate: view("item-2"), confidence: 0.8, reasonZh: "迟到的候选。" }],
      }),
    );
    expect(container.textContent).not.toContain("迟到的候选");
  });

  it("clears suggestions and suppresses a late response when the selected revision changes", async () => {
    const pending =
      deferred<Awaited<ReturnType<MaintenanceApi["suggestLearningItemDuplicates"]>>>();
    const maintenanceApi = api({ suggestLearningItemDuplicates: vi.fn(() => pending.promise) });
    const { container, root } = await render(maintenanceApi);
    const suggest = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "查找语义重复",
    );
    await act(async () => suggest?.click());
    await act(async () =>
      root.render(
        <LearningItemMaintenancePanel
          api={maintenanceApi}
          detail={view("item-1", 2)}
          idempotencyKey={() => "write-2"}
          onDeleted={async () => undefined}
          onUpdated={async () => undefined}
        />,
      ),
    );
    await act(async () =>
      pending.resolve({
        itemRevision: 1,
        suggestions: [
          { candidate: view("item-2"), confidence: 0.8, reasonZh: "旧 revision 的候选。" },
        ],
      }),
    );
    expect(container.textContent).not.toContain("旧 revision 的候选");
  });

  it("reports a completed archive honestly when its server reread fails", async () => {
    const maintenanceApi = api();
    const { container } = await render(maintenanceApi, {
      onUpdated: async () => {
        throw new Error("refresh failed");
      },
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-request-archive-learning-item]")?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-confirm-archive-learning-item]")?.click(),
    );

    expect(maintenanceApi.archiveLearningItem).toHaveBeenCalledOnce();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "操作已完成，但重新载入失败",
    );
  });

  it("disables archive confirmation while one write is pending", async () => {
    const archived = { ...view("item-1", 2), archivedAt: "2026-08-14T03:00:00.000Z" };
    const pending = deferred<LearningItemDetailResponse>();
    const maintenanceApi = api({ archiveLearningItem: vi.fn(() => pending.promise) });
    const { container } = await render(maintenanceApi);
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-request-archive-learning-item]")?.click(),
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-confirm-archive-learning-item]",
    );
    await act(async () => confirm?.click());
    expect(confirm?.disabled).toBe(true);
    confirm?.click();
    expect(maintenanceApi.archiveLearningItem).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(archived));
  });
});
