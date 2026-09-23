interface OutdatedPort {
  readonly name: string;
  readonly onMessage: { addListener(listener: (value: unknown) => void): void };
  postMessage(value: object): void;
}

/** Rejection only: no old request parsing, query execution or protocol translation. */
export function rejectOutdatedAnalysisPort(port: OutdatedPort): boolean {
  // The immediately preceding shipped Store wire can render this fixed refresh error.
  if (port.name !== "huayi-store-analysis-v5") return false;
  let rejected = false;
  port.onMessage.addListener(() => {
    if (rejected) return;
    rejected = true;
    try {
      port.postMessage({
        code: "version-mismatch",
        messageVersion: 5,
        requestId: null,
        type: "store/analysis-error",
      });
    } catch {
      // An old document may already have closed. Never retry or inspect its payload.
    }
  });
  return true;
}
