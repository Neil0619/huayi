import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  authenticateProductionPrincipalRequest,
  createProductionAnalysisAuthenticator,
} from "./production-principal-authentication.js";
import { authenticateProductionExtensionRequest } from "./production-extension-authentication.js";
import { authenticateWebAccountRequest } from "./web-account-authentication.js";

const token = "m".repeat(43);
const authorization = `HuayiMiniProgram ${token}`;
const policy = { capability: "disabled" as const };
const identity = () => ({
  authenticateMiniProgram: vi.fn(async () => ({ userId: "mini-user" })),
  authenticateExtension: vi.fn(async () => ({ userId: "extension-user" })),
  authenticateWebSession: vi.fn(async () => ({ userId: "web-user" })),
  authenticateWebMutation: vi.fn(async () => ({ userId: "web-user" })),
});
describe("explicit mini-program learning principal", () => {
  it("works only when the route's identity port opts in, independent of Store capability", async () => {
    const adapter = identity();
    await expect(
      authenticateProductionPrincipalRequest(adapter, { authorization }, policy),
    ).resolves.toEqual({ kind: "miniprogram", userId: "mini-user" });
    expect(adapter.authenticateMiniProgram).toHaveBeenCalledWith(token);
    const webOnly = {
      authenticateWebSession: adapter.authenticateWebSession,
      authenticateWebMutation: adapter.authenticateWebMutation,
      authenticateExtension: adapter.authenticateExtension,
    };
    await expect(
      authenticateProductionPrincipalRequest(webOnly, { authorization }, policy),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("never downgrades malformed mini credentials to Web cookies", async () => {
    const adapter = identity();
    await expect(
      authenticateProductionPrincipalRequest(
        adapter,
        { authorization: "HuayiMiniProgram bad", cookie: "huayi_session=web", method: "GET" },
        policy,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(adapter.authenticateWebSession).not.toHaveBeenCalled();
  });
  it("can access opted-in learning but cannot become an Extension or Web account principal", async () => {
    const adapter = identity();
    const app = new Hono();
    app.onError((_error, context) => context.json({ error: "denied" }, 403));
    app.get("/learning", async (context) =>
      context.json(await createProductionAnalysisAuthenticator(adapter, policy)(context)),
    );
    app.get("/extension", async (context) =>
      context.json(await authenticateProductionExtensionRequest(adapter, context, policy)),
    );
    app.get("/web", async (context) =>
      context.json(await authenticateWebAccountRequest(adapter, context)),
    );
    expect((await app.request("/learning", { headers: { authorization } })).status).toBe(200);
    expect((await app.request("/extension", { headers: { authorization } })).status).toBe(403);
    expect((await app.request("/web", { headers: { authorization } })).status).toBe(403);
  });
});
