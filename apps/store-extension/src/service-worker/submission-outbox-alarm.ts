import type { SubmissionOutbox } from "./submission-outbox.js";

export const SUBMISSION_OUTBOX_ALARM = "huayi-cloud-submission-outbox";
export const SUBMISSION_OUTBOX_RETRY_DELAY_MS = 60_000;

export async function runSubmissionOutboxAlarm(
  outbox: Pick<SubmissionOutbox, "process">,
  schedule: () => void,
): Promise<void> {
  try {
    const result = await outbox.process();
    if (result.pending) schedule();
  } catch {
    schedule();
  }
}
