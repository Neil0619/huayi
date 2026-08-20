import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";

import type { PatchLearningItemRequest } from "@huayi/cloud-contracts";

export function LearningItemEditForm({
  draft,
  editHeading,
  onCancel,
  onSubmit,
  pending,
  setDraft,
}: {
  readonly draft: PatchLearningItemRequest;
  readonly editHeading: RefObject<HTMLHeadingElement | null>;
  readonly onCancel: () => void;
  readonly onSubmit: (event: FormEvent) => void;
  readonly pending: boolean;
  readonly setDraft: Dispatch<SetStateAction<PatchLearningItemRequest>>;
}) {
  return (
    <form className="library-edit-form" onSubmit={onSubmit}>
      <h3 ref={editHeading} tabIndex={-1}>
        编辑学习项
      </h3>
      {draft.content.type === "expression" ? (
        <>
          <label>
            英文表达
            <input
              maxLength={500}
              name="editText"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((current) =>
                  current.content.type === "expression"
                    ? { ...current, content: { ...current.content, text: value } }
                    : current,
                );
              }}
              required
              value={draft.content.text}
            />
          </label>
          <label>
            中文含义
            <textarea
              maxLength={4_000}
              name="editMeaningZh"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((current) =>
                  current.content.type === "expression"
                    ? { ...current, content: { ...current.content, meaningZh: value } }
                    : current,
                );
              }}
              required
              value={draft.content.meaningZh}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            句型模板
            <input
              maxLength={1_000}
              name="editTemplate"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((current) =>
                  current.content.type === "sentence_pattern"
                    ? { ...current, content: { ...current.content, template: value } }
                    : current,
                );
              }}
              required
              value={draft.content.template}
            />
          </label>
          <label>
            中文功能
            <textarea
              maxLength={4_000}
              name="editFunctionZh"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((current) =>
                  current.content.type === "sentence_pattern"
                    ? { ...current, content: { ...current.content, functionZh: value } }
                    : current,
                );
              }}
              required
              value={draft.content.functionZh}
            />
          </label>
        </>
      )}
      <label>
        用法
        <textarea
          maxLength={4_000}
          name="editUsageZh"
          onChange={(event) =>
            setDraft({
              ...draft,
              content: { ...draft.content, usageZh: event.currentTarget.value },
            })
          }
          required
          value={draft.content.usageZh}
        />
      </label>
      <label>
        标签（逗号分隔）
        <input
          name="editTags"
          onChange={(event) =>
            setDraft({
              ...draft,
              tags: event.currentTarget.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
          value={draft.tags.join(", ")}
        />
      </label>
      <label>
        系统属性（逗号分隔）
        <input
          name="editSystemAttributes"
          onChange={(event) =>
            setDraft({
              ...draft,
              systemAttributes: event.currentTarget.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
          value={draft.systemAttributes.join(", ")}
        />
      </label>
      <div className="form-actions">
        <button disabled={pending} type="submit">
          保存修改
        </button>
        <button disabled={pending} onClick={onCancel} type="button">
          取消
        </button>
      </div>
    </form>
  );
}
