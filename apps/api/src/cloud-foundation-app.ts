import {
  approveExtensionPairingRequestSchema,
  claimInvitationRequestSchema,
  createExtensionPairingRequestSchema,
  exchangeExtensionPairingRequestSchema,
  passwordLoginRequestSchema,
  passwordRegistrationRequestSchema,
  passwordRegistrationResendRequestSchema,
  passwordRegistrationResendResponseSchema,
  passwordRegistrationResumeRequestSchema,
  type ApiError,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import { createCloudWebSession } from "./cloud-authentication-session.js";
import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";
import { createGoogleAuthenticationApp } from "./google-authentication-app.js";
import { createPasswordReauthenticationApp } from "./password-reauthentication-app.js";
import { createPasswordLinkApp } from "./password-link-app.js";
import { createPasswordLinkModule } from "./password-link-module.js";
import { createPasswordSignupConfirmationApp } from "./password-signup-confirmation-app.js";
import { enforceRateLimit } from "./rate-limiter.js";
import { webSessionCookie } from "./web-session-cookie.js";
import { strictJson } from "./strict-json.js";

export interface CloudFoundationVariables {
  requestId: string;
}

export function errorStatus(
  code: CloudFault["code"],
): 400 | 401 | 403 | 404 | 409 | 426 | 429 | 502 | 503 {
  if (code === "authentication_required") return 401;
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
  if (code === "quota_exhausted" || code === "rate_limited") return 429;
  if (code === "client_upgrade_required") return 426;
  if (code === "model_output_invalid") return 502;
  if (code === "model_unavailable") return 503;
  if (
    code === "invitation_consumed" ||
    code === "sign_in_method_already_linked" ||
    code === "idempotency_conflict" ||
    code === "learning_item_archived" ||
    code === "learning_item_in_use" ||
    code === "learning_item_must_be_archived" ||
    code === "word_entry_in_use" ||
    code === "practice_session_in_use" ||
    code === "revision_conflict" ||
    code === "generation_busy" ||
    code === "exact_duplicate"
  )
    return 409;
  return 400;
}

export function createCloudFoundationApp(dependencies: CloudFoundationDependencies) {
  const app = new Hono<{ Variables: CloudFoundationVariables }>();

  app.use("*", async (context, next) => {
    const id = crypto.randomUUID();
    context.set("requestId", id);
    await next();
    context.header("X-Request-Id", id);
  });

  app.use(
    "/v1/*",
    cors({
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "If-Match",
        "X-CSRF-Token",
        "X-Huayi-Client-Version",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      exposeHeaders: ["Content-Disposition"],
      origin:
        dependencies.extensionOrigin === undefined
          ? [dependencies.webOrigin]
          : [dependencies.webOrigin, dependencies.extensionOrigin],
    }),
  );

  const clientIp = (context: Context) =>
    context.req.header("x-vercel-forwarded-for") ?? "unavailable";
  const limit = (context: Context, action: string, discriminator: string, maximum: number) =>
    enforceRateLimit(dependencies.rateLimiter, {
      action,
      limit: maximum,
      subject: `${clientIp(context)}:${discriminator}`,
      windowMs: 60_000,
    });

  app.onError((error, context) => {
    const fault =
      error instanceof CloudFault
        ? error
        : new CloudFault("invalid_request", "The request could not be completed.");
    const body: ApiError = {
      error: { code: fault.code, message: fault.message, requestId: context.get("requestId") },
    };
    return context.json(body, errorStatus(fault.code));
  });

  app.post("/v1/invitations/claim", async (context) => {
    const input = await strictJson(context, claimInvitationRequestSchema);
    await limit(context, "invitation.claim", input.invitationToken, 5);
    const claim = await dependencies.identity.claimInvitation(input.invitationToken);
    return context.json({
      claimTicket: claim.claimTicket,
      expiresAt: claim.expiresAt.toISOString(),
    });
  });

  if (dependencies.googleAuthenticationEnabled) {
    app.route("/", createGoogleAuthenticationApp(dependencies));
  }
  app.route("/", createPasswordReauthenticationApp(dependencies));
  app.route(
    "/",
    createPasswordLinkApp({
      link: createPasswordLinkModule({
        auth: dependencies.auth,
        protectRefreshToken: dependencies.protectRefreshToken,
        protectTransientAuthState:
          dependencies.protectTransientAuthState ?? dependencies.protectRefreshToken,
        repository: dependencies.passwordLink,
        unprotectRefreshToken: dependencies.unprotectRefreshToken,
        unprotectTransientAuthState: dependencies.unprotectTransientAuthState ?? ((value) => value),
      }),
      rateLimiter: dependencies.rateLimiter,
    }),
  );

  app.route("/", createPasswordSignupConfirmationApp(dependencies));

  app.get("/v1/auth/csrf", async (context) => {
    const sessionId = webSessionCookie(context);
    if (sessionId === undefined || context.req.header("origin") !== dependencies.webOrigin) {
      throw new CloudFault("authentication_required", "Web session proof is required.");
    }
    const csrf = await dependencies.identity.rotateWebCsrf(sessionId);
    context.header("Cache-Control", "private, no-store");
    return context.json(csrf);
  });

  app.post("/v1/auth/password/register", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const input = await strictJson(context, passwordRegistrationRequestSchema);
    await limit(context, "auth.register", input.email, 5);
    await dependencies.identity.requireClaimTicket(input.claimTicket);
    const flow = await dependencies.identity.createAuthFlow(input.claimTicket);
    const pending = await dependencies.auth.registerPassword({
      email: input.email,
      password: input.password,
      redirectTo: `${dependencies.apiOrigin}/v1/auth/password/confirm?flow=${encodeURIComponent(flow.flowId)}`,
    });
    await dependencies.identity.bindInvitationIdentity(
      input.claimTicket,
      pending.userId,
      pending.email,
    );
    if (pending.session === undefined) {
      return context.json({ emailConfirmationRequired: true }, 202);
    }
    await dependencies.identity.completeAuthFlow(
      flow.flowId,
      pending.userId,
      pending.email,
      "password",
    );
    const session = await createCloudWebSession(dependencies, pending.session);
    context.header("Set-Cookie", session.setCookie);
    return context.json({
      access: session.access,
      csrfToken: session.csrfToken,
      emailConfirmationRequired: false,
    });
  });

  app.post("/v1/auth/password/register/resume", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const input = await strictJson(context, passwordRegistrationResumeRequestSchema);
    await limit(context, "auth.register-resume", input.email, 5);
    const authSession = await dependencies.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    await dependencies.identity.resumeInterruptedPasswordRegistration(
      input.invitationToken,
      authSession.userId,
      authSession.email,
    );
    const session = await createCloudWebSession(dependencies, authSession);
    context.header("Set-Cookie", session.setCookie);
    return context.json({
      access: session.access,
      csrfToken: session.csrfToken,
      emailConfirmationRequired: false as const,
    });
  });

  app.post("/v1/auth/password/register/resend", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const input = await strictJson(context, passwordRegistrationResendRequestSchema);
    const ip = clientIp(context);
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "auth.register-resend.ip",
      limit: 5,
      subject: ip,
      windowMs: 3_600_000,
    });
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "auth.register-resend.invitation",
      limit: 3,
      subject: input.invitationToken,
      windowMs: 3_600_000,
    });
    const renewal = await dependencies.identity.renewPasswordRegistrationConfirmation(
      input.invitationToken,
    );
    await dependencies.auth.resendPasswordRegistrationOtp({
      email: renewal.email,
      redirectTo: `${dependencies.apiOrigin}/v1/auth/password/confirm?flow=${encodeURIComponent(renewal.flowId)}`,
    });
    return context.json(passwordRegistrationResendResponseSchema.parse({ accepted: true }), 202);
  });

  app.post("/v1/auth/password/login", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const input = await strictJson(context, passwordLoginRequestSchema);
    await limit(context, "auth.password", input.email, 5);
    const authSession = await dependencies.auth.signInWithPassword(input);
    await dependencies.identity.authorizeSignInMethod(authSession.userId, "password");
    const session = await createCloudWebSession(dependencies, authSession);
    context.header("Set-Cookie", session.setCookie);
    return context.json({ access: session.access, csrfToken: session.csrfToken });
  });

  app.post("/v1/auth/logout", async (context) => {
    const sessionId = webSessionCookie(context);
    const csrf = context.req.header("x-csrf-token");
    const origin = context.req.header("origin");
    if (sessionId === undefined || csrf === undefined || origin === undefined) {
      throw new CloudFault("authentication_required", "Web session proof is required.");
    }
    await dependencies.identity.authenticateWebMutation(sessionId, origin, csrf);
    await dependencies.identity.revokeWebSession(sessionId);
    context.header(
      "Set-Cookie",
      "huayi_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    );
    return context.body(null, 204);
  });

  if (dependencies.extensionOrigin !== undefined) {
    app.post("/v1/extension-pairings", async (context) => {
      const input = await strictJson(context, createExtensionPairingRequestSchema);
      await limit(context, "pairing.create", input.installIdHash, 10);
      const pairing = await dependencies.identity.createExtensionPairing(input);
      return context.json(
        {
          expiresAt: pairing.expiresAt.toISOString(),
          id: pairing.id,
          pairingPath: `/pair-extension/${pairing.id}`,
          status: pairing.status,
        },
        201,
      );
    });

    app.get("/v1/extension-pairings/:id", async (context) => {
      await limit(context, "pairing.poll", context.req.param("id"), 60);
      const pairing = await dependencies.identity.getExtensionPairing(context.req.param("id"));
      if (pairing.status === "consumed") {
        throw new CloudFault("not_found", "Pairing is no longer available.");
      }
      return context.json({
        expiresAt: pairing.expiresAt.toISOString(),
        id: pairing.id,
        pairingPath: `/pair-extension/${pairing.id}`,
        status: pairing.status,
      });
    });

    app.post("/v1/extension-pairings/:id/approve", async (context) => {
      const sessionId = webSessionCookie(context);
      const csrf = context.req.header("x-csrf-token");
      const origin = context.req.header("origin");
      if (sessionId === undefined || csrf === undefined || origin === undefined) {
        throw new CloudFault("authentication_required", "Web session proof is required.");
      }
      const authentication = await dependencies.identity.authenticateWebMutation(
        sessionId,
        origin,
        csrf,
      );
      const input = await strictJson(context, approveExtensionPairingRequestSchema);
      await dependencies.identity.approveExtensionPairing(
        context.req.param("id"),
        authentication.userId,
        input,
      );
      return context.body(null, 204);
    });

    app.post("/v1/extension-pairings/:id/exchange", async (context) => {
      const input = await strictJson(context, exchangeExtensionPairingRequestSchema);
      await limit(context, "pairing.exchange", context.req.param("id"), 10);
      const session = await dependencies.identity.exchangeExtensionPairing(
        context.req.param("id"),
        input.state,
        input.pkceVerifier,
      );
      return context.json({
        expiresAt: session.expiresAt.toISOString(),
        preferences: session.preferences,
        sessionToken: session.sessionToken,
      });
    });

    app.get("/v1/extension-sessions", async (context) => {
      const sessionId = webSessionCookie(context);
      if (sessionId === undefined) {
        throw new CloudFault("authentication_required", "Web session proof is required.");
      }
      const authentication = await dependencies.identity.authenticateWebSession(sessionId);
      const sessions = await dependencies.identity.listExtensionSessions(authentication.userId);
      return context.json({
        items: sessions.map((session) => ({
          deviceLabel: session.deviceLabel,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          id: session.id,
          lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
        })),
      });
    });

    app.delete("/v1/extension-sessions/:id", async (context) => {
      const sessionId = webSessionCookie(context);
      const csrf = context.req.header("x-csrf-token");
      const origin = context.req.header("origin");
      if (sessionId === undefined || csrf === undefined || origin === undefined) {
        throw new CloudFault("authentication_required", "Web session proof is required.");
      }
      const authentication = await dependencies.identity.authenticateWebMutation(
        sessionId,
        origin,
        csrf,
      );
      await dependencies.identity.revokeExtensionSession(
        authentication.userId,
        context.req.param("id"),
      );
      return context.body(null, 204);
    });
  }

  return app;
}
