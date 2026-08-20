import {
  STORE_MESSAGE_VERSION,
  parseSubmissionOutboxRequest,
  parseSubmissionOutboxResponse,
  type SubmissionOutboxOutcome,
  type SubmissionOutboxResponse,
} from "@huayi/store-domain";

import type { SubmissionOutbox } from "./submission-outbox.js";

interface SubmissionOutboxHandlerOptions {
  readonly outbox: Pick<SubmissionOutbox, "clear" | "process" | "status">;
  readonly runtimeId: string;
  readonly scheduleRetry: () => void;
  readonly sender: {
    readonly id?: string | undefined;
    readonly url?: string | undefined;
  };
}

function isExactPopupSender(
  sender: SubmissionOutboxHandlerOptions["sender"],
  runtimeId: string,
): boolean {
  if (sender.id !== runtimeId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === runtimeId &&
      url.pathname === "/popup.html" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function response(
  status: Awaited<ReturnType<SubmissionOutbox["status"]>>,
  outcome: SubmissionOutboxOutcome,
): SubmissionOutboxResponse {
  return parseSubmissionOutboxResponse({
    ...status,
    messageVersion: STORE_MESSAGE_VERSION,
    outcome,
    type: "store/submission-outbox-result",
  });
}

export async function handleSubmissionOutboxMessage(
  raw: unknown,
  options: SubmissionOutboxHandlerOptions,
): Promise<SubmissionOutboxResponse | undefined> {
  if (!isExactPopupSender(options.sender, options.runtimeId)) return undefined;
  let request;
  try {
    request = parseSubmissionOutboxRequest(raw);
  } catch {
    return undefined;
  }
  if (request.type === "store/submission-outbox-clear") {
    await options.outbox.clear();
    return response({ state: "empty" }, "cleared");
  }
  if (request.type === "store/submission-outbox-status") {
    return response(await options.outbox.status(), "status");
  }
  const result = await options.outbox.process();
  if (result.pending) options.scheduleRetry();
  const outcome: SubmissionOutboxOutcome =
    result.status === "retry"
      ? "retry-pending"
      : result.status === "not-configured" || result.status === "idle"
        ? "idle"
        : result.status;
  return response(await options.outbox.status(), outcome);
}
