import type { ExportOutboxItem } from "@huayi/store-domain";

import { EudicClientError } from "./eudic-client.js";

export type EudicFailure = Exclude<NonNullable<ExportOutboxItem["lastError"]>, "entry-missing">;

export function eudicFailureCode(error: unknown): EudicFailure {
  if (error instanceof EudicClientError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "data-corrupt") return error.code;
  }
  return "network-error";
}
