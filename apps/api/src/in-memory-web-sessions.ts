import { CloudFault } from "./cloud-fault.js";
import type { SignInMethod } from "@huayi/cloud-contracts";
import type { AccountStatus, WebSession } from "./identity-state.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

interface InMemoryWebSessionOptions {
  authorizeMethod(userId: string, method: SignInMethod): unknown;
  clock: Clock;
  pepper: string;
  profileEmails: Map<string, string>;
  profiles: Map<string, AccountStatus>;
  secrets: SecretSource;
  webOrigin: string;
}

export function createInMemoryWebSessions(options: InMemoryWebSessionOptions) {
  const sessions = new Map<string, WebSession>();

  function issueWebSession(
    userId: string,
    refreshCiphertext: string,
    email: string | undefined,
    reauthenticatedAt: Date,
    reauthenticatedMethod: SignInMethod | null,
  ) {
    const status = options.profiles.get(userId);
    if (status !== "active" && status !== "disabled") {
      throw new CloudFault("forbidden", "The account cannot create a Web session.");
    }
    const access = status === "active" ? ("full" as const) : ("data-rights" as const);
    if (email !== undefined) options.profileEmails.set(userId, email.trim().toLowerCase());
    const sessionId = opaqueSecret(options.secrets);
    const csrfToken = opaqueSecret(options.secrets);
    const expiresAt = addMilliseconds(options.clock.now(), 30 * 24 * 60 * 60 * 1_000);
    sessions.set(hashSecret(sessionId, options.pepper), {
      access,
      csrfHash: hashSecret(csrfToken, options.pepper),
      expiresAt,
      refreshCiphertext,
      reauthenticatedAt,
      reauthenticatedMethod,
      revoked: false,
      userId,
    });
    return {
      access,
      csrfToken,
      expiresAt,
      sessionId,
      setCookie: `huayi_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    };
  }

  function createWebSession(userId: string, refreshCiphertext: string, email?: string) {
    return issueWebSession(userId, refreshCiphertext, email, options.clock.now(), null);
  }

  function authenticateWebSession(sessionId: string) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    if (session === undefined || session.revoked || session.expiresAt <= options.clock.now()) {
      throw new CloudFault("authentication_required", "The Web session is invalid.");
    }
    if (options.profiles.get(session.userId) !== "active" || session.access !== "full") {
      throw new CloudFault("authentication_required", "A full Web session is required.");
    }
    return { reauthenticatedAt: session.reauthenticatedAt, userId: session.userId };
  }

  function authenticateDataRightsSession(sessionId: string) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    const status = session === undefined ? undefined : options.profiles.get(session.userId);
    if (
      session === undefined ||
      session.revoked ||
      session.expiresAt <= options.clock.now() ||
      !(
        (status === "active" && session.access === "full") ||
        (status === "disabled" && session.access === "data-rights")
      )
    ) {
      throw new CloudFault("authentication_required", "The data-rights session is invalid.");
    }
    return {
      access: session.access,
      reauthenticatedAt: session.reauthenticatedAt,
      userId: session.userId,
    };
  }

  function authenticateWebMutation(sessionId: string, origin: string, csrfToken: string) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    const authentication = authenticateWebSession(sessionId);
    if (
      origin !== options.webOrigin ||
      session === undefined ||
      !secretMatches(csrfToken, session.csrfHash, options.pepper)
    ) {
      throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
    }
    return authentication;
  }

  function authenticateDataRightsMutation(sessionId: string, origin: string, csrfToken: string) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    const authentication = authenticateDataRightsSession(sessionId);
    if (
      origin !== options.webOrigin ||
      session === undefined ||
      !secretMatches(csrfToken, session.csrfHash, options.pepper)
    ) {
      throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
    }
    return authentication;
  }

  function preparePasswordReauthentication(sessionId: string, origin: string, csrfToken: string) {
    const authentication = authenticateWebMutation(sessionId, origin, csrfToken);
    options.authorizeMethod(authentication.userId, "password");
    const email = options.profileEmails.get(authentication.userId);
    if (email === undefined) {
      throw new CloudFault("authentication_required", "Password authentication is unavailable.");
    }
    return { email, userId: authentication.userId };
  }

  function completeReauthenticatedWebSession(
    sessionId: string,
    providerUserId: string,
    refreshCiphertext: string,
    method: SignInMethod,
  ) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    const authentication = authenticateWebSession(sessionId);
    if (session === undefined || authentication.userId !== providerUserId) {
      throw new CloudFault("authentication_required", "Password authentication did not match.");
    }
    options.authorizeMethod(providerUserId, method);
    const replacement = issueWebSession(
      providerUserId,
      refreshCiphertext,
      undefined,
      options.clock.now(),
      method,
    );
    session.revoked = true;
    return replacement;
  }

  function completePasswordReauthentication(
    sessionId: string,
    providerUserId: string,
    refreshCiphertext: string,
  ) {
    return completeReauthenticatedWebSession(
      sessionId,
      providerUserId,
      refreshCiphertext,
      "password",
    );
  }

  function readGoogleLinkSession(sessionId: string, origin: string, csrfToken: string) {
    const authentication = authenticateWebMutation(sessionId, origin, csrfToken);
    requireRecentAuthentication(sessionId, "password");
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    if (session === undefined) throw new CloudFault("authentication_required", "Invalid session.");
    return { refreshCiphertext: session.refreshCiphertext, userId: authentication.userId };
  }

  function readPasswordLinkSession(sessionId: string, origin: string, csrfToken: string) {
    const authentication = authenticateWebMutation(sessionId, origin, csrfToken);
    requireRecentAuthentication(sessionId, "google");
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    if (session === undefined) throw new CloudFault("authentication_required", "Invalid session.");
    return { refreshCiphertext: session.refreshCiphertext, userId: authentication.userId };
  }

  function saveGoogleLinkRefresh(
    sessionId: string,
    expectedUserId: string,
    refreshCiphertext: string,
  ): void {
    const authentication = authenticateWebSession(sessionId);
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    if (session === undefined || authentication.userId !== expectedUserId) {
      throw new CloudFault("authentication_required", "Google link session did not match.");
    }
    session.refreshCiphertext = refreshCiphertext;
  }

  function readGoogleLinkRefresh(sessionId: string) {
    const authentication = authenticateWebSession(sessionId);
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    if (session === undefined) throw new CloudFault("authentication_required", "Invalid session.");
    return { refreshCiphertext: session.refreshCiphertext, userId: authentication.userId };
  }

  function completeGoogleLinkedWebSession(
    sessionId: string,
    expectedUserId: string,
    refreshCiphertext: string,
  ) {
    const authentication = authenticateWebSession(sessionId);
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    if (session === undefined || authentication.userId !== expectedUserId) {
      throw new CloudFault("authentication_required", "Google link session did not match.");
    }
    const reauthenticatedAt = session.reauthenticatedAt;
    const reauthenticatedMethod = session.reauthenticatedMethod;
    revokeAllWebSessions(expectedUserId);
    const replacement = issueWebSession(
      expectedUserId,
      refreshCiphertext,
      undefined,
      reauthenticatedAt,
      reauthenticatedMethod,
    );
    return { ...replacement, access: "full" as const };
  }

  function revokeWebSession(sessionId: string): void {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    if (session !== undefined) session.revoked = true;
  }

  function requireRecentAuthentication(sessionId: string, method: SignInMethod) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    const authentication = authenticateWebSession(sessionId);
    const age =
      session === undefined
        ? Number.POSITIVE_INFINITY
        : options.clock.now().getTime() - session.reauthenticatedAt.getTime();
    if (
      session === undefined ||
      session.reauthenticatedMethod !== method ||
      age < 0 ||
      age > 15 * 60 * 1_000
    ) {
      throw new CloudFault("authentication_required", "Recent authentication is required.");
    }
    return { userId: authentication.userId };
  }

  function revokeAllWebSessions(userId: string): void {
    for (const session of sessions.values()) {
      if (session.userId === userId) session.revoked = true;
    }
  }

  function rotateWebSession(sessionId: string) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    const authentication = authenticateWebSession(sessionId);
    if (session === undefined) throw new CloudFault("authentication_required", "Invalid session.");
    const replacement = issueWebSession(
      authentication.userId,
      session.refreshCiphertext,
      undefined,
      session.reauthenticatedAt,
      session.reauthenticatedMethod,
    );
    session.revoked = true;
    return replacement;
  }

  function rotateWebCsrf(sessionId: string) {
    const session = sessions.get(hashSecret(sessionId, options.pepper));
    const authentication = authenticateDataRightsSession(sessionId);
    if (session === undefined) throw new CloudFault("authentication_required", "Invalid session.");
    const csrfToken = opaqueSecret(options.secrets);
    session.csrfHash = hashSecret(csrfToken, options.pepper);
    return { access: authentication.access, csrfToken };
  }

  return {
    authenticateDataRightsMutation,
    authenticateDataRightsSession,
    authenticateWebMutation,
    authenticateWebSession,
    completeReauthenticatedWebSession,
    completePasswordReauthentication,
    createWebSession,
    googleLinkSessions: {
      complete: completeGoogleLinkedWebSession,
      read: readGoogleLinkSession,
      readRefresh: readGoogleLinkRefresh,
      saveRefresh: saveGoogleLinkRefresh,
    },
    passwordLinkSessions: {
      complete: completeGoogleLinkedWebSession,
      read: readPasswordLinkSession,
      readRefresh: readGoogleLinkRefresh,
      saveRefresh: saveGoogleLinkRefresh,
    },
    preparePasswordReauthentication,
    requireRecentAuthentication,
    revokeAllWebSessions,
    revokeWebSession,
    rotateWebCsrf,
    rotateWebSession,
  };
}
