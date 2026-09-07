import {
  apiErrorSchema,
  diagnosticListSchema,
  diagnosticQuerySchema,
  type DiagnosticQuery,
} from "@huayi/cloud-contracts";
import { WebIdentityApiError } from "./identity-api.js";

export function createWebErrorLogsApi(options: {
  apiOrigin: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const origin = new URL(options.apiOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new TypeError("Invalid API origin.");
  return {
    async listErrorLogs(query: DiagnosticQuery) {
      const safe = diagnosticQuerySchema.parse(query);
      const url = new URL("/v1/admin/error-logs", origin);
      for (const [key, value] of Object.entries(safe))
        if (value !== undefined) url.searchParams.set(key, String(value));
      const response = await options.fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
        throw new WebIdentityApiError(
          parsed.success ? parsed.data.error.code : "unknown",
          response.status,
        );
      }
      return diagnosticListSchema.parse(await response.json());
    },
  };
}
export type WebErrorLogsApi = ReturnType<typeof createWebErrorLogsApi>;
