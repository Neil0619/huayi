import { revisionWriteHeadersSchema } from "@huayi/cloud-contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { readRevisionHeader } from "./revision-header.js";

function adapter() {
  const app = new Hono();
  app.onError((_error, context) => context.json({ rejected: true }, 400));
  app.patch("/resource", (context) => {
    const proof = revisionWriteHeadersSchema.parse({
      "idempotency-key": context.req.header("idempotency-key"),
      "if-match": readRevisionHeader(context),
    });
    return context.json({ revision: Number(proof["if-match"].slice(1, -1)) });
  });
  return app;
}

describe("application revision transport", () => {
  it.each([
    { "X-Huayi-Revision": '"3"' },
    { "If-Match": '"3"' },
    { "X-Huayi-Revision": '"3"', "If-Match": '"3"' },
  ])("preserves one unambiguous revision from %j", async (headers) => {
    const response = await adapter().request("/resource", {
      method: "PATCH",
      headers: { ...headers, "Idempotency-Key": "write-1" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revision: 3 });
  });

  it.each([
    {},
    { "X-Huayi-Revision": "3" },
    { "X-Huayi-Revision": '"0"' },
    { "X-Huayi-Revision": 'W/"3"' },
    { "X-Huayi-Revision": "*" },
    { "X-Huayi-Revision": '"3", "4"' },
    { "X-Huayi-Revision": '"3"', "If-Match": '"4"' },
    { "X-Huayi-Revision": "", "If-Match": '"3"' },
  ])("rejects missing, invalid or conflicting revision proof %j", async (headers) => {
    expect(
      (
        await adapter().request("/resource", {
          method: "PATCH",
          headers: { ...headers, "Idempotency-Key": "write-1" },
        })
      ).status,
    ).toBe(400);
  });
});
