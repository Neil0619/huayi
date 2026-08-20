import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  DeleteLearningItemResponse,
  DuplicateSuggestionsResponse,
  LearningItemDetailResponse,
  MergePreviewResponse,
  PatchLearningItemRequest,
} from "@huayi/cloud-contracts";

import type { LearningLibraryApi } from "./learning-library-api-port.js";
import { LearningItemEditForm } from "./learning-item-edit-form.js";
import { LearningItemMaintenanceActions } from "./learning-item-maintenance-actions.js";

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

function errorMessage(error: unknown) {
  const code = error instanceof Error && "code" in error ? error.code : "unknown";
  if (code === "exact_duplicate") return "已有完全相同的学习项。草稿已保留。";
  if (code === "revision_conflict") return "学习项已在其他位置更新。草稿已保留，请重新载入。";
  if (code === "learning_item_in_use") return "该学习项仍受练习记录约束，暂时不能执行此操作。";
  if (code === "learning_item_must_be_archived") return "请先归档该学习项，再执行永久删除。";
  if (code === "learning_item_archived") return "该学习项已归档，请先恢复后再修改。";
  if (code === "quota_exhausted") return "本月语义建议额度已用完。当前详情已保留。";
  if (code === "generation_busy") return "语义建议仍在处理中。当前详情已保留，请稍后再次点击。";
  if (code === "model_output_invalid") return "语义建议结果无效。当前详情已保留，请再次点击重试。";
  if (code === "model_unavailable") {
    return "语义重复建议暂时不可用。当前详情已保留，请稍后再次点击重试。";
  }
  return "操作暂时失败。草稿已保留，请重试。";
}

function editableRequest(detail: LearningItemDetailResponse): PatchLearningItemRequest {
  return {
    content: detail.item.content,
    expectedRevision: detail.item.revision,
    systemAttributes: detail.item.systemAttributes,
    tags: detail.item.tags,
  };
}

export function LearningItemMaintenancePanel({
  api,
  detail,
  idempotencyKey,
  onDeleted,
  onUpdated,
}: {
  readonly api: MaintenanceApi;
  readonly detail: LearningItemDetailResponse;
  readonly idempotencyKey: () => string;
  readonly onDeleted: (response: DeleteLearningItemResponse) => Promise<void>;
  readonly onUpdated: (detail: LearningItemDetailResponse, status: string) => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(() => editableRequest(detail));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<MergePreviewResponse | null>(null);
  const [status, setStatus] = useState("");
  const [suggestions, setSuggestions] = useState<DuplicateSuggestionsResponse | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setConfirmDelete(false);
    setDraft(editableRequest(detail));
    setEditing(false);
    setError(null);
    setPreview(null);
    setSuggestions(null);
  }, [detail]);

  useEffect(() => {
    if (editing) editHeading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (confirmDelete) confirmButton.current?.focus();
  }, [confirmDelete]);

  const run = async (operation: (activeGeneration: number) => Promise<void>) => {
    const activeGeneration = generation.current;
    setPending(true);
    setError(null);
    try {
      await operation(activeGeneration);
    } catch (caught) {
      if (activeGeneration === generation.current) setError(errorMessage(caught));
    } finally {
      if (activeGeneration === generation.current) setPending(false);
    }
  };

  const publishUpdate = async (
    activeGeneration: number,
    updated: LearningItemDetailResponse,
    message: string,
  ) => {
    try {
      await onUpdated(updated, message);
    } catch {
      if (activeGeneration === generation.current) {
        setError("操作已完成，但重新载入失败。请手动刷新后确认最新状态。");
      }
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async (activeGeneration) => {
      const updated = await api.patchLearningItem(detail.item.id, draft, idempotencyKey());
      if (activeGeneration !== generation.current) return;
      await publishUpdate(activeGeneration, updated, "学习项已更新，并从服务器重新载入。");
    });
  };

  const suggest = () => {
    void run(async (activeGeneration) => {
      const response = await api.suggestLearningItemDuplicates(
        detail.item.id,
        { expectedRevision: detail.item.revision },
        idempotencyKey(),
      );
      if (activeGeneration !== generation.current) return;
      setSuggestions(response);
      setStatus(response.suggestions.length === 0 ? "没有发现语义重复候选。" : "已载入重复候选。");
    });
  };

  const openPreview = (candidate: LearningItemDetailResponse) => {
    void run(async (activeGeneration) => {
      const response = await api.previewLearningItemMerge(detail.item.id, {
        sourceRevision: detail.item.revision,
        targetItemId: candidate.item.id,
        targetRevision: candidate.item.revision,
      });
      if (activeGeneration === generation.current) setPreview(response);
    });
  };

  const merge = () => {
    if (preview === null || !preview.allowed) return;
    void run(async (activeGeneration) => {
      const response = await api.confirmLearningItemMerge(
        detail.item.id,
        {
          sourceRevision: preview.source.item.revision,
          targetItemId: preview.target.item.id,
          targetRevision: preview.target.item.revision,
        },
        idempotencyKey(),
      );
      if (activeGeneration !== generation.current) return;
      await publishUpdate(
        activeGeneration,
        response.target,
        "已合并；来源学习项已删除，目标排期保持不变。",
      );
    });
  };

  const remove = () => {
    void run(async (activeGeneration) => {
      const response = await api.deleteLearningItem(
        detail.item.id,
        { expectedRevision: detail.item.revision },
        idempotencyKey(),
      );
      if (activeGeneration !== generation.current) return;
      try {
        await onDeleted(response);
      } catch {
        if (activeGeneration === generation.current) {
          setError("删除已完成，但重新载入失败。请手动刷新后确认最新状态。");
        }
      }
    });
  };

  const archive = () => {
    void run(async (activeGeneration) => {
      const updated = await api.archiveLearningItem(
        detail.item.id,
        { expectedRevision: detail.item.revision },
        idempotencyKey(),
      );
      if (activeGeneration !== generation.current) return;
      await publishUpdate(activeGeneration, updated, "学习项已归档；排期与练习记录均已保留。");
    });
  };

  const restore = () => {
    void run(async (activeGeneration) => {
      const updated = await api.restoreLearningItem(
        detail.item.id,
        { expectedRevision: detail.item.revision },
        idempotencyKey(),
      );
      if (activeGeneration !== generation.current) return;
      await publishUpdate(activeGeneration, updated, "学习项已恢复，并沿用归档前排期。");
    });
  };

  return (
    <section aria-label="维护学习项" className="library-maintenance">
      <LearningItemMaintenanceActions
        archived={detail.archivedAt !== null}
        canHardDelete={!detail.hasPracticeHistory}
        onArchive={archive}
        onDelete={() => setConfirmDelete(true)}
        onEdit={() => setEditing(true)}
        onRestore={restore}
        onSuggest={suggest}
        pending={pending}
      />
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {error !== null && <p role="alert">{error}</p>}
      {editing && (
        <LearningItemEditForm
          draft={draft}
          editHeading={editHeading}
          onCancel={() => setEditing(false)}
          onSubmit={save}
          pending={pending}
          setDraft={setDraft}
        />
      )}
      {confirmDelete && (
        <div className="destructive-confirm" role="group" aria-label="确认删除学习项">
          <p>
            {detail.archivedAt === null
              ? "确认删除？此操作会永久删除尚未练习的正文、来源、标签关联和排期，无法撤销。"
              : "确认永久删除？正文、来源、标签和排期将无法恢复；既有练习题、作答、对话和反馈会保留，需在练习历史中分别删除。相同内容以后重建会成为全新学习项。"}
          </p>
          <button
            className="danger-button"
            disabled={pending}
            onClick={remove}
            ref={confirmButton}
            type="button"
          >
            {detail.archivedAt === null ? "确认删除" : "确认永久删除"}
          </button>
          <button disabled={pending} onClick={() => setConfirmDelete(false)} type="button">
            取消
          </button>
        </div>
      )}
      {suggestions !== null && (
        <div className="duplicate-suggestions">
          <h3>语义重复候选</h3>
          {suggestions.suggestions.length === 0 ? (
            <p>没有发现候选。</p>
          ) : (
            suggestions.suggestions.map((suggestion) => (
              <article key={suggestion.candidate.item.id}>
                <strong>
                  {suggestion.candidate.item.content.type === "expression"
                    ? suggestion.candidate.item.content.text
                    : suggestion.candidate.item.content.template}
                </strong>
                <p>{suggestion.reasonZh}</p>
                <button onClick={() => openPreview(suggestion.candidate)} type="button">
                  预览合并
                </button>
              </article>
            ))
          )}
        </div>
      )}
      {preview !== null && (
        <div className="merge-preview">
          <h3>合并预览</h3>
          <p>保留目标学习项的正文与排期；来源的标签、属性和来源例句将去重并入。</p>
          {!preview.allowed && <p role="alert">该来源已有练习历史或排期，不能安全合并。</p>}
          {preview.allowed && (
            <button disabled={pending} onClick={merge} type="button">
              确认合并并删除来源
            </button>
          )}
        </div>
      )}
    </section>
  );
}
