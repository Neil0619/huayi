import type { Request, Route } from "@playwright/test";
import {
  contractFixtures,
  extensionQueryEventSchema,
  extensionQueryRequestSchema,
  idempotencyKeySchema,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type {
  CloudBrowserAuthenticatedAs,
  CloudBrowserRequestFact,
} from "./cloud-browser-authority-types.js";

interface ExtensionQueryAuthorityContext {
  authentication(request: Request): CloudBrowserAuthenticatedAs;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
}

function encodeSse(events: readonly unknown[]) {
  return events
    .map((event, index) => `event: query\nid: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

export function createCloudBrowserExtensionQueryAuthority(options?: { quotaExhausted?: boolean }) {
  let count = 0;
  return {
    count: () => count,
    async handle(route: Route, context: ExtensionQueryAuthorityContext): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname !== "/v1/extension-queries:stream" || request.method() !== "POST") {
        return false;
      }
      const parsed = extensionQueryRequestSchema.safeParse(cloudRequestBody(request));
      if (
        context.authentication(request) !== "extension" ||
        request.headers()["x-huayi-client-version"] !== "1.0.0" ||
        !idempotencyKeySchema.safeParse(request.headers()["idempotency-key"]).success ||
        !parsed.success ||
        parsed.data.action !== "translate" ||
        parsed.data.selectionKind !== "sentence"
      ) {
        await context.reject(route, 403, "forbidden");
        return true;
      }
      count += 1;
      if (options?.quotaExhausted === true) {
        await context.reject(route, 402, "quota_exhausted", "write-valid");
        return true;
      }
      const generationId = `query-generation-${count}`;
      const events = [
        extensionQueryEventSchema.parse({ generationId, type: "query.started" }),
        extensionQueryEventSchema.parse({
          generationId,
          quota: contractFixtures.completedEvent.quota,
          result: {
            requestId: generationId,
            selectionKind: "sentence",
            sourceText: parsed.data.sourceText,
            translationZh: "调查整个冬天都在持续。",
            type: "translate-passage",
          },
          type: "query.completed",
        }),
      ];
      context.record(request, "write-valid");
      await route.fulfill({
        body: encodeSse(events),
        contentType: "text/event-stream; charset=utf-8",
        headers: { ...cloudCors(request.headers().origin), "cache-control": "no-store" },
        status: 200,
      });
      return true;
    },
  };
}
