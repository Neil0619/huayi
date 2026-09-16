import { backfillErrorResponseSchema } from "../../backfill/backfill-error-schema.js";

export async function requestBackfillReview(
  sendMessage: (message: unknown) => Promise<unknown>,
  message: unknown,
  failure: { stale: () => void; unavailable: () => void },
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      sendMessage(message),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 12_000);
      }),
    ]);
    const parsed = backfillErrorResponseSchema.safeParse(response);
    if (parsed.success && !["authentication", "permission"].includes(parsed.data.code)) {
      failure.stale();
      throw new Error("unconfirmed");
    }
    if (
      typeof response === "object" &&
      response !== null &&
      "reason" in response &&
      response.reason === "stale"
    ) {
      failure.stale();
      throw new Error("stale");
    }
    if (
      typeof response !== "object" ||
      response === null ||
      !("accepted" in response) ||
      response.accepted !== true
    ) {
      failure.unavailable();
      throw new Error("unavailable");
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}
