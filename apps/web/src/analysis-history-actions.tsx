import type { RefObject } from "react";

import type { AnalysisRecord } from "@huayi/cloud-contracts";

export function AnalysisHistoryActions({
  actionBusy,
  confirmButton,
  confirmingDelete,
  deleteStudyCapture,
  onArchive,
  onCancelDelete,
  onConfirmDelete,
  onDeleteStudyCaptureChange,
  onProcess,
  onRestore,
  onStartDelete,
  record,
}: {
  readonly actionBusy: boolean;
  readonly confirmButton: RefObject<HTMLButtonElement | null>;
  readonly confirmingDelete: boolean;
  readonly deleteStudyCapture: boolean;
  readonly onArchive: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onDeleteStudyCaptureChange: (checked: boolean) => void;
  readonly onProcess: () => void;
  readonly onRestore: () => void;
  readonly onStartDelete: () => void;
  readonly record: AnalysisRecord;
}) {
  return (
    <div className="analysis-history-actions">
      {record.reviewState === "pendingReview" && (
        <button data-process-analysis disabled={actionBusy} onClick={onProcess} type="button">
          无需收藏，标记已整理
        </button>
      )}
      {record.archivedAt === null ? (
        <button data-archive-analysis disabled={actionBusy} onClick={onArchive} type="button">
          归档
        </button>
      ) : (
        <button data-restore-analysis disabled={actionBusy} onClick={onRestore} type="button">
          恢复
        </button>
      )}
      {!confirmingDelete ? (
        <button data-delete-analysis disabled={actionBusy} onClick={onStartDelete} type="button">
          删除…
        </button>
      ) : (
        <div className="analysis-history-delete">
          <p>确认删除这条分析？已复制到学习库的来源快照会保留。</p>
          {record.studyCaptureId !== undefined && (
            <label>
              <input
                checked={deleteStudyCapture}
                name="deleteStudyCapture"
                onChange={(event) => onDeleteStudyCaptureChange(event.currentTarget.checked)}
                type="checkbox"
              />
              同时删除原始 StudyCapture
            </label>
          )}
          <button
            data-confirm-delete
            disabled={actionBusy}
            onClick={onConfirmDelete}
            ref={confirmButton}
            type="button"
          >
            确认删除
          </button>
          <button onClick={onCancelDelete} type="button">
            取消
          </button>
        </div>
      )}
    </div>
  );
}
