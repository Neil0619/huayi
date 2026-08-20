import {
  STORE_MESSAGE_VERSION,
  parseStoreStudyCaptureRequest,
  parseStoreStudyCaptureResponse,
  type StoreStudyCaptureResponse,
} from "@huayi/store-domain";
import { studyCaptureCreateResponseSchema } from "@huayi/cloud-contracts";

import type { CloudStudyCaptureApi } from "./cloud-study-capture-api.js";
import type { ExtensionPreferenceCache } from "./extension-preference-cache.js";
import type { ExtensionSessionVault } from "./extension-session-vault.js";
import type { SubmissionOutbox } from "./submission-outbox.js";

interface StudyCaptureHandlerOptions {
  readonly api: CloudStudyCaptureApi | null;
  readonly createIdempotencyKey: () => string;
  readonly outbox: Pick<SubmissionOutbox, "enqueue" | "process" | "remove">;
  readonly preferences: Pick<ExtensionPreferenceCache, "sync">;
  readonly runtimeId: string;
  readonly scheduleRetry: () => void;
  readonly sender: {
    readonly id?: string | undefined;
    readonly url?: string | undefined;
  };
  readonly sessionVault: Pick<ExtensionSessionVault, "readSession">;
}

function trustedContentSender(sender: StudyCaptureHandlerOptions["sender"], runtimeId: string) {
  if (sender.id !== runtimeId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function simple(
  outcome: "existing" | "failed" | "linked-analysis" | "skipped" | "unavailable" | "undone",
) {
  return parseStoreStudyCaptureResponse({
    messageVersion: STORE_MESSAGE_VERSION,
    outcome,
    type: "store/study-capture-result",
  });
}

export async function handleStudyCaptureMessage(
  raw: unknown,
  options: StudyCaptureHandlerOptions,
): Promise<StoreStudyCaptureResponse | undefined> {
  if (!trustedContentSender(options.sender, options.runtimeId)) return undefined;
  let request;
  try {
    request = parseStoreStudyCaptureRequest(raw);
  } catch {
    return undefined;
  }
  const preferences = await options.preferences.sync();
  if (preferences === null) return simple("unavailable");
  if (request.type === "store/study-capture-undo-local") {
    return simple((await options.outbox.remove(request.localQueueId)) ? "undone" : "failed");
  }
  const session = await options.sessionVault.readSession();
  if (session === null) return simple("unavailable");
  if (request.type === "store/study-capture-undo-remote") {
    if (options.api === null) return simple("failed");
    try {
      await options.api.undo(
        request.captureId,
        request.expectedRevision,
        options.createIdempotencyKey(),
        session.token,
      );
      return simple("undone");
    } catch {
      return simple("failed");
    }
  }
  if (
    request.trigger === "automatic" &&
    (preferences.studyCaptureMode !== "automatic" || request.kind === "phrase")
  ) {
    return simple("skipped");
  }
  const queued = await options.outbox.enqueue({
    payload: { kind: request.kind, sourceText: request.sourceText },
    type: "study-capture",
  });
  if (queued.status === "local-only" || queued.localQueueId === undefined) {
    return simple("unavailable");
  }
  try {
    const processed = await options.outbox.process();
    if (
      processed.status === "submitted" &&
      processed.submittedId === queued.localQueueId &&
      processed.submission !== undefined
    ) {
      const envelope = processed.submission;
      if (
        typeof envelope !== "object" ||
        envelope === null ||
        !("type" in envelope) ||
        envelope.type !== "study-capture" ||
        !("response" in envelope)
      ) {
        return simple("failed");
      }
      const result = studyCaptureCreateResponseSchema.parse(envelope.response);
      if (result.outcome === "created") {
        return parseStoreStudyCaptureResponse({
          captureId: result.undo.captureId,
          expectedRevision: result.undo.expectedRevision,
          messageVersion: STORE_MESSAGE_VERSION,
          outcome: "created",
          type: "store/study-capture-result",
        });
      }
      return simple(result.outcome);
    }
    if (processed.pending) options.scheduleRetry();
  } catch {
    options.scheduleRetry();
  }
  return parseStoreStudyCaptureResponse({
    localQueueId: queued.localQueueId,
    messageVersion: STORE_MESSAGE_VERSION,
    outcome: "queued",
    type: "store/study-capture-result",
  });
}
