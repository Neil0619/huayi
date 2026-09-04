import { useState } from "react";

import { InboxApp, type InboxApi } from "./inbox-app.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import { StudyCaptureInbox, type StudyCaptureStatus } from "./study-capture-inbox.js";

export function StudyInbox({
  captureApi,
  createIdempotencyKey,
  reviewApi,
}: {
  readonly captureApi: WebStudyCaptureApi;
  readonly createIdempotencyKey?: (() => string) | undefined;
  readonly reviewApi: InboxApi;
}) {
  const [tab, setTab] = useState<"capture" | "review">("capture");
  const [captureStatus, setCaptureStatus] = useState<StudyCaptureStatus>("unfinished");
  const selectTab = (next: typeof tab) => {
    if (next !== tab) setCaptureStatus("unfinished");
    setTab(next);
  };
  const tabs = (
    <div aria-label="待整理分类" className="study-inbox-tabs" role="tablist">
      <button
        aria-selected={tab === "capture"}
        onClick={() => selectTab("capture")}
        role="tab"
        type="button"
      >
        待分析
      </button>
      <button
        aria-selected={tab === "review"}
        onClick={() => selectTab("review")}
        role="tab"
        type="button"
      >
        待收藏
      </button>
    </div>
  );
  return (
    <div className="study-inbox">
      <header className="page-heading">
        <h1>待整理</h1>
      </header>
      <div className="study-inbox-toolbar">
        {tabs}
        {tab === "capture" && (
          <label className="capture-status-filter">
            显示状态
            <select
              value={captureStatus}
              onChange={(event) =>
                setCaptureStatus(event.currentTarget.value as StudyCaptureStatus)
              }
            >
              <option value="unfinished">待分析与分析中</option>
              <option value="pending">待分析</option>
              <option value="analyzing">分析中</option>
              <option value="analyzed">已分析</option>
            </select>
          </label>
        )}
      </div>
      {tab === "capture" ? (
        <StudyCaptureInbox
          api={captureApi}
          captureStatus={captureStatus}
          onAnalyzed={() => setTab("review")}
          {...(createIdempotencyKey === undefined ? {} : { createIdempotencyKey })}
        />
      ) : (
        <InboxApp
          api={reviewApi}
          embedded
          {...(createIdempotencyKey === undefined ? {} : { createIdempotencyKey })}
        />
      )}
    </div>
  );
}
