import type { PasswordSignupSession } from "@huayi/cloud-contracts";

import type { AuthSession } from "./auth-provider.js";
import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";
import { hashSecret, opaqueSecret, secretMatches, systemSecrets } from "./security.js";
import {
  parsePasswordSignupState,
  protectPasswordSignupState,
  signupUnavailable,
  type PasswordSignupState,
} from "./password-signup-state.js";

const browserPurpose = "password-signup-browser-v1";
const operationTimeoutMs = 120_000;
const tokenPattern = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u;
interface Snapshot {
  flowId: string;
  ciphertext: string;
  state: PasswordSignupState;
}

function busy(): CloudFault {
  return new CloudFault("revision_conflict", "Registration is already being updated.");
}
function publicSession(state: PasswordSignupState): PasswordSignupSession {
  return {
    csrfToken: state.csrfToken,
    email: state.email,
    step: ["pending", "verifying", "resending"].includes(state.stage)
      ? "verify-email"
      : "set-password",
  };
}

export function createPasswordSignupModule(dependencies: CloudFoundationDependencies) {
  const redirectTo = (flow: string) =>
    `${dependencies.apiOrigin}/v1/auth/password/confirm?flow=${encodeURIComponent(flow)}`;
  const expiredOperation = (state: PasswordSignupState) =>
    (state.startedAt ?? Infinity) + operationTimeoutMs < Date.now();
  const pending = (state: PasswordSignupState) =>
    state.stage === "pending" ||
    ((state.stage === "verifying" || state.stage === "resending") && expiredOperation(state));

  async function transition(snapshot: Snapshot, state: PasswordSignupState): Promise<Snapshot> {
    const ciphertext = protectPasswordSignupState(dependencies, state);
    if (
      !(await dependencies.identity.comparePasswordSignupState(
        snapshot.flowId,
        snapshot.ciphertext,
        ciphertext,
      ))
    )
      throw busy();
    return { ...snapshot, ciphertext, state };
  }

  async function read(browser: string | undefined, csrfToken?: string): Promise<Snapshot> {
    if (browser === undefined || !tokenPattern.test(browser)) throw signupUnavailable();
    const [flowId = "", proof = ""] = browser.split(".");
    const ciphertext = await dependencies.identity.readPasswordSignupState(flowId);
    const state = parsePasswordSignupState(dependencies, ciphertext);
    if (
      !secretMatches(proof, state.browserHash, browserPurpose) ||
      (csrfToken !== undefined && csrfToken !== state.csrfToken)
    )
      throw signupUnavailable();
    return { flowId, ciphertext, state };
  }

  async function release(snapshot: Snapshot, previous: PasswordSignupState) {
    await dependencies.identity.comparePasswordSignupState(
      snapshot.flowId,
      snapshot.ciphertext,
      protectPasswordSignupState(dependencies, previous),
    );
  }

  function requireIdentity(
    state: PasswordSignupState,
    session: Pick<AuthSession, "email" | "userId">,
  ) {
    if (session.userId !== state.userId || session.email !== state.email) throw signupUnavailable();
  }

  return {
    async start(claimTicket: string, email: string) {
      await dependencies.identity.requireClaimTicket(claimTicket);
      const flow = await dependencies.identity.createAuthFlow(claimTicket);
      const registered = await dependencies.auth.registerPassword({
        email,
        password: opaqueSecret(systemSecrets),
        redirectTo: redirectTo(flow.flowId),
      });
      if (
        registered.session !== undefined ||
        !registered.emailConfirmationRequired ||
        registered.email !== email
      )
        throw signupUnavailable();
      await dependencies.identity.bindInvitationIdentity(
        claimTicket,
        registered.userId,
        registered.email,
      );
      const proof = opaqueSecret(systemSecrets);
      const state: PasswordSignupState = {
        kind: "password-signup-v1",
        stage: "pending",
        browserHash: hashSecret(proof, browserPurpose),
        csrfToken: opaqueSecret(systemSecrets),
        claimTicket,
        email: registered.email,
        userId: registered.userId,
      };
      await dependencies.identity.saveAuthFlowState(
        flow.flowId,
        protectPasswordSignupState(dependencies, state),
      );
      return { browser: `${flow.flowId}.${proof}`, session: publicSession(state) };
    },

    async session(browser: string | undefined) {
      const { state } = await read(browser);
      if (
        ["verifying", "resending", "setting-password"].includes(state.stage) &&
        !expiredOperation(state)
      )
        throw busy();
      return publicSession(state);
    },

    async boundEmail(browser: string | undefined, csrf: string) {
      return (await read(browser, csrf)).state.email;
    },

    async verify(browser: string | undefined, csrf: string, token: string) {
      const snapshot = await read(browser, csrf);
      if (!pending(snapshot.state)) throw busy();
      const held = await transition(snapshot, {
        ...snapshot.state,
        stage: "verifying",
        startedAt: Date.now(),
      });
      try {
        const verified = await dependencies.auth.verifyPasswordRegistrationOtp({
          email: snapshot.state.email,
          token,
        });
        requireIdentity(snapshot.state, verified);
        if (verified.authState === undefined) throw signupUnavailable();
        const next = await transition(held, {
          ...snapshot.state,
          stage: "verified",
          authState: verified.authState,
        });
        return publicSession(next.state);
      } catch {
        await release(held, { ...snapshot.state, stage: "pending" });
        throw signupUnavailable();
      }
    },

    async resend(browser: string | undefined, csrf: string) {
      const snapshot = await read(browser, csrf);
      if (!pending(snapshot.state)) throw busy();
      const held = await transition(snapshot, {
        ...snapshot.state,
        stage: "resending",
        startedAt: Date.now(),
      });
      try {
        await dependencies.auth.resendPasswordRegistrationOtp({
          email: snapshot.state.email,
          redirectTo: redirectTo(snapshot.flowId),
        });
      } catch {
        throw signupUnavailable();
      } finally {
        await release(held, { ...snapshot.state, stage: "pending" });
      }
    },

    async complete(browser: string | undefined, csrf: string, password: string) {
      let snapshot = await read(browser, csrf);
      const state = snapshot.state;
      if (state.stage === "setting-password" && !expiredOperation(state)) throw busy();
      if (
        !["verified", "setting-password", "password-set"].includes(state.stage) ||
        state.authState === undefined
      )
        throw signupUnavailable();
      if (
        state.passwordHash !== undefined &&
        !secretMatches(password, state.passwordHash, state.csrfToken)
      )
        throw signupUnavailable();
      if (state.stage !== "password-set") {
        const held = await transition(snapshot, {
          ...state,
          stage: "setting-password",
          startedAt: Date.now(),
          passwordHash: hashSecret(password, state.csrfToken),
        });
        let updated;
        try {
          updated = await dependencies.auth.setPassword({
            authState: state.authState,
            password,
          });
        } catch {
          // A lost update response can leave the provider password set. Only proof of that
          // exact password may recover the operation; a different password cannot win a race.
          try {
            const signedIn = await dependencies.auth.signInWithPassword({
              email: state.email,
              password,
            });
            requireIdentity(state, signedIn);
            snapshot = await transition(held, { ...held.state, stage: "password-set" });
          } catch {
            await release(held, { ...held.state, stage: "verified" });
            throw signupUnavailable();
          }
        }
        if (updated !== undefined) {
          if (updated.userId !== state.userId) throw signupUnavailable();
          snapshot = await transition(held, {
            ...held.state,
            stage: "password-set",
            authState: updated.authState,
          });
        }
      } else {
        // Renew the short claim after a lost completion response, without setting
        // a password again. Only the previously chosen password reaches this point.
        snapshot = await transition(snapshot, state);
      }
      const session = await dependencies.auth.signInWithPassword({ email: state.email, password });
      requireIdentity(state, session);
      await dependencies.identity.completeAuthFlow(
        snapshot.flowId,
        session.userId,
        session.email,
        "password",
      );
      return session;
    },
  };
}
