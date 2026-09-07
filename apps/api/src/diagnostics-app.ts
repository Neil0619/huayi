import {
  diagnosticQuerySchema,
  diagnosticUploadSchema,
  type DiagnosticList,
  type DiagnosticQuery,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AdminAuthorization } from "./admin-operations-module.js";
import { CloudFault } from "./cloud-fault.js";
import type { DiagnosticWriter } from "./diagnostic-context.js";
import { enforceRateLimit, type RateLimiter } from "./rate-limiter.js";
import { strictJson } from "./strict-json.js";

export function createDiagnosticsApp(options: {
  authenticateClient(context: Context): Promise<{ userId: string; kind: "web" | "extension" }>;
  authenticateAdmin(context: Context): Promise<AdminAuthorization>;
  write: DiagnosticWriter;
  list(authorization: AdminAuthorization, query: DiagnosticQuery): Promise<DiagnosticList>;
  rateLimiter: RateLimiter;
}) {
  const app = new Hono();
  app.use(
    "/v1/diagnostics",
    bodyLimit({
      maxSize: 32_768,
      onError: () => {
        throw new CloudFault("invalid_request", "Diagnostic batch is too large.");
      },
    }),
  );
  app.post("/v1/diagnostics", async (context) => {
    context.header("Cache-Control", "private, no-store");
    try {
      const principal = await options.authenticateClient(context);
      await enforceRateLimit(options.rateLimiter, {
        action: "diagnostics.upload",
        subject: principal.userId,
        limit: 20,
        windowMs: 60_000,
      });
      const input = await strictJson(context, diagnosticUploadSchema);
      const source = principal.kind === "extension" ? "store" : "web";
      if (input.events.some((event) => event.source !== source || event.release !== undefined)) {
        throw new CloudFault("invalid_request", "Invalid diagnostic source.");
      }
      await options.write(input.events.map((event) => ({ event, userId: principal.userId })));
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof CloudFault) throw error;
      // Keep transient authentication, rate-limit storage and persistence outages retryable.
      context.header("Retry-After", "60");
      return context.body(null, 503);
    }
  });
  app.get("/v1/admin/error-logs", async (context) => {
    const auth = await options.authenticateAdmin(context);
    const query = diagnosticQuerySchema.safeParse(context.req.query());
    if (!query.success) throw new CloudFault("invalid_request", "Invalid error log filters.");
    context.header("Cache-Control", "private, no-store");
    return context.json(await options.list(auth, query.data));
  });
  return app;
}
