import { miniProgramRoutes, resourceIdSchema } from "@huayi/cloud-contracts";
import { Hono } from "hono";
import type { AccountDataRightsModule } from "./account-data-rights-module.js";
import { CloudFault } from "./cloud-fault.js";
import { miniProgramToken } from "./miniprogram-authentication.js";
import type { MiniProgramIdentity } from "./miniprogram-identity.js";

export function createMiniProgramExportApp(options: {
  identity: Pick<MiniProgramIdentity, "authenticate">;
  module: Pick<AccountDataRightsModule, "createDownload">;
  storageOrigin: string;
  bucket: string;
  fetch?: typeof fetch;
}) {
  const app = new Hono();
  app.get(miniProgramRoutes.downloadExport, async (context) => {
    const auth = await options.identity.authenticate(
      miniProgramToken(context.req.header("authorization")),
    );
    const id = resourceIdSchema.parse(context.req.param("id"));
    const download = await options.module.createDownload(auth.userId, id, auth.reauthenticatedAt);
    const url = new URL(download.url);
    if (
      url.protocol !== "https:" ||
      url.origin !== options.storageOrigin ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`/storage/v1/object/sign/${options.bucket}/account-exports/`)
    ) {
      throw new CloudFault("forbidden", "Invalid export authority.");
    }
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new CloudFault("not_found", "The export could not be downloaded.");
    }
    if (!response.ok || !response.body)
      throw new CloudFault("not_found", "The export is unavailable.");
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="seen-said-${id}.ndjson"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  return app;
}
