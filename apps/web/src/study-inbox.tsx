import { useState } from "react";

import { InboxApp, type InboxApi } from "./inbox-app.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import { StudyCaptureInbox } from "./study-capture-inbox.js";

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
  return (
    <>
      <div aria-label="待整理分类" className="study-inbox-tabs" role="tablist">
        <button
          aria-selected={tab === "capture"}
          onClick={() => setTab("capture")}
          role="tab"
          type="button"
        >
          待分析
        </button>
        <button
          aria-selected={tab === "review"}
          onClick={() => setTab("review")}
          role="tab"
          type="button"
        >
          待收藏
        </button>
      </div>
      {tab === "capture" ? (
        <StudyCaptureInbox
          api={captureApi}
          onAnalyzed={() => setTab("review")}
          {...(createIdempotencyKey === undefined ? {} : { createIdempotencyKey })}
        />
      ) : (
        <InboxApp
          api={reviewApi}
          {...(createIdempotencyKey === undefined ? {} : { createIdempotencyKey })}
        />
      )}
    </>
  );
}
