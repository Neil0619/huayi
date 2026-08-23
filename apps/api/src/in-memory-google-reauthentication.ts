import { CloudFault } from "./cloud-fault.js";
import type { AuthFlow } from "./identity-state.js";
import type { InMemoryWebSessions } from "./in-memory-web-sessions.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  type Clock,
  type SecretSource,
} from "./security.js";

interface InMemoryGoogleReauthenticationOptions {
  authFlows: Map<string, AuthFlow>;
  authorizeGoogle(userId: string): unknown;
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
  web: Pick<
    InMemoryWebSessions,
    "authenticateWebMutation" | "authenticateWebSession" | "completeReauthenticatedWebSession"
  >;
}

export function createInMemoryGoogleReauthentication(
  options: InMemoryGoogleReauthenticationOptions,
) {
  function createGoogleReauthentication(sessionId: string, origin: string, csrfToken: string) {
    const authentication = options.web.authenticateWebMutation(sessionId, origin, csrfToken);
    options.authorizeGoogle(authentication.userId);
    const flowId = opaqueSecret(options.secrets);
    const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
    options.authFlows.set(hashSecret(flowId, options.pepper), {
      expiresAt,
      kind: "reauthenticate-google",
      ownerUserId: authentication.userId,
      used: false,
      webSessionHash: hashSecret(sessionId, options.pepper),
    });
    return { expiresAt, flowId };
  }

  function continueGoogleReauthentication(flowId: string, sessionId: string): void {
    const flow = options.authFlows.get(hashSecret(flowId, options.pepper));
    const authentication = options.web.authenticateWebSession(sessionId);
    if (
      flow === undefined ||
      flow.kind !== "reauthenticate-google" ||
      flow.used ||
      flow.started === true ||
      flow.expiresAt <= options.clock.now() ||
      flow.ownerUserId !== authentication.userId ||
      flow.webSessionHash !== hashSecret(sessionId, options.pepper)
    ) {
      throw new CloudFault("authentication_required", "Google authentication is unavailable.");
    }
    options.authorizeGoogle(authentication.userId);
    flow.started = true;
  }

  function completeGoogleReauthentication(
    flowId: string,
    sessionId: string,
    providerUserId: string,
    refreshCiphertext: string,
  ) {
    const flow = options.authFlows.get(hashSecret(flowId, options.pepper));
    if (
      flow === undefined ||
      flow.kind !== "reauthenticate-google" ||
      flow.used ||
      flow.started !== true ||
      flow.expiresAt <= options.clock.now() ||
      flow.webSessionHash !== hashSecret(sessionId, options.pepper)
    ) {
      throw new CloudFault("authentication_required", "Google authentication is unavailable.");
    }
    if (flow.ownerUserId !== providerUserId) {
      flow.used = true;
      throw new CloudFault("authentication_required", "Google authentication did not match.");
    }
    const session = options.web.completeReauthenticatedWebSession(
      sessionId,
      providerUserId,
      refreshCiphertext,
      "google",
    );
    flow.used = true;
    return session;
  }

  return {
    completeGoogleReauthentication,
    continueGoogleReauthentication,
    createGoogleReauthentication,
  };
}
