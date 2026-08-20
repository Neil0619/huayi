import { cloudWordCopyRequestSchema, type CloudWordCopyRequest } from "@huayi/cloud-contracts";

import type { ExtensionPreferenceCache } from "./extension-preference-cache.js";
import type { SubmissionOutbox } from "./submission-outbox.js";

export function createCloudWordCopyClient(options: {
  outbox: Pick<SubmissionOutbox, "enqueue" | "process">;
  preferences: Pick<ExtensionPreferenceCache, "sync">;
  scheduleRetry(): void;
}) {
  return {
    async copy(input: CloudWordCopyRequest) {
      const payload = cloudWordCopyRequestSchema.parse(input);
      const preferences = await options.preferences.sync();
      if (preferences === null) return "unavailable" as const;
      if (preferences.cloudWordCopyMode !== "enabled") return "disabled" as const;
      const queued = await options.outbox.enqueue({ payload, type: "cloud-word-copy" });
      if (queued.status === "local-only" || queued.localQueueId === undefined) {
        return "unavailable" as const;
      }
      try {
        const processed = await options.outbox.process();
        if (processed.pending) options.scheduleRetry();
        return processed.status === "submitted" && processed.submittedId === queued.localQueueId
          ? ("submitted" as const)
          : ("queued" as const);
      } catch {
        options.scheduleRetry();
        return "queued" as const;
      }
    },
  };
}

export type CloudWordCopyClient = ReturnType<typeof createCloudWordCopyClient>;
