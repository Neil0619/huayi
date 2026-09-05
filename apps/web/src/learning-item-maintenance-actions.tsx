import { useEffect, useRef, useState } from "react";

export function LearningItemMaintenanceActions({
  archived,
  canHardDelete,
  onArchive,
  onDelete,
  onEdit,
  onRestore,
  onSuggest,
  pending,
  suggesting = false,
}: {
  readonly archived: boolean;
  readonly canHardDelete: boolean;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
  readonly onRestore: () => void;
  readonly onSuggest: () => void;
  readonly pending: boolean;
  readonly suggesting?: boolean;
}) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const confirmArchiveButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setConfirmArchive(false);
  }, [archived]);

  useEffect(() => {
    if (confirmArchive) confirmArchiveButton.current?.focus();
  }, [confirmArchive]);

  return (
    <div className="library-maintenance-actions">
      {archived ? (
        <>
          <button data-restore-learning-item disabled={pending} onClick={onRestore} type="button">
            恢复学习项
          </button>
          <button className="danger-button" disabled={pending} onClick={onDelete} type="button">
            永久删除学习项
          </button>
        </>
      ) : (
        <>
          <button disabled={pending} onClick={onEdit} type="button">
            编辑
          </button>
          <button disabled={pending || suggesting} onClick={onSuggest} type="button">
            查找语义重复
          </button>
          <button
            data-request-archive-learning-item
            disabled={pending}
            onClick={() => setConfirmArchive(true)}
            type="button"
          >
            归档学习项
          </button>
          {canHardDelete && (
            <button className="danger-button" disabled={pending} onClick={onDelete} type="button">
              删除学习项
            </button>
          )}
          {confirmArchive && (
            <div aria-label="确认归档学习项" className="destructive-confirm" role="group">
              <p>归档会停止新的练习，但保留内容、排期和全部练习历史。确认继续？</p>
              <button
                data-confirm-archive-learning-item
                disabled={pending}
                onClick={onArchive}
                ref={confirmArchiveButton}
                type="button"
              >
                确认归档
              </button>
              <button disabled={pending} onClick={() => setConfirmArchive(false)} type="button">
                取消
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
