import type { FormEvent } from "react";
import type { StudyCaptureDetailResponse } from "@huayi/cloud-contracts";

interface Props {
  activeRequestId: string | null;
  busy: boolean;
  confirmDelete: boolean;
  detail: StudyCaptureDetailResponse;
  kind: "passage" | "phrase" | "sentence";
  onAnalyze(): void;
  onBeginDelete(): void;
  onCancelAnalysis(): void;
  onCancelDelete(): void;
  onDelete(): void;
  onKind(value: Props["kind"]): void;
  onRecheck(): void;
  onSubmit(event: FormEvent): void;
  onTitle(value: string): void;
  onUserContext(value: string): void;
  title: string;
  userContext: string;
}

export function StudyCaptureDetailPanel(props: Props) {
  const capture = props.detail.capture;
  const editable = capture.status === "pending" && !props.busy;
  return (
    <section className="analysis-detail">
      <header>
        <p>遇到 {capture.captureCount} 次</p>
        <h2>{capture.sourceText}</h2>
      </header>
      <form onSubmit={props.onSubmit}>
        <label>
          类型
          <select
            disabled={!editable}
            name="kind"
            value={props.kind}
            onChange={(event) => props.onKind(event.currentTarget.value as Props["kind"])}
          >
            <option value="phrase">短语</option>
            <option value="sentence">句子</option>
            <option value="passage">段落</option>
          </select>
        </label>
        <label>
          标题（可选）
          <input
            disabled={!editable}
            name="title"
            value={props.title}
            onChange={(event) => props.onTitle(event.currentTarget.value)}
          />
        </label>
        <label>
          学习上下文（可选）
          <textarea
            disabled={!editable}
            name="userContext"
            value={props.userContext}
            onChange={(event) => props.onUserContext(event.currentTarget.value)}
          />
        </label>
        <div className="form-actions">
          {capture.status === "pending" && (
            <button data-save-capture disabled={props.busy} type="submit">
              保存采集信息
            </button>
          )}
          {capture.status !== "analyzing" && (
            <button
              data-analyze-capture
              disabled={props.busy}
              onClick={props.onAnalyze}
              type="button"
            >
              {capture.status === "analyzed" ? "重新分析（再次消耗额度）" : "开始深度分析"}
            </button>
          )}
          {props.busy && (
            <button onClick={props.onCancelAnalysis} type="button">
              停止本页等待
            </button>
          )}
          {!props.busy && props.activeRequestId !== null && (
            <button data-recheck-analysis onClick={props.onRecheck} type="button">
              检查同一次分析
            </button>
          )}
          {!props.confirmDelete ? (
            <button
              data-delete-capture
              disabled={!editable}
              onClick={props.onBeginDelete}
              type="button"
            >
              删除这条采集
            </button>
          ) : (
            <>
              <button
                data-confirm-delete-capture
                disabled={props.busy}
                onClick={props.onDelete}
                type="button"
              >
                确认删除
              </button>
              <button disabled={props.busy} onClick={props.onCancelDelete} type="button">
                取消
              </button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}
