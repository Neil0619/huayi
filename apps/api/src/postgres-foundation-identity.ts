import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";
import type { ApproveExtensionPairingRequest, ExtensionPreferences } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import { createPostgresWebSession } from "./postgres-web-session.js";
import { createPostgresSignInMethods } from "./postgres-sign-in-methods.js";
import { createPostgresPasswordReauthentication } from "./postgres-password-reauthentication.js";
import { createPostgresGoogleReauthentication } from "./postgres-google-reauthentication.js";
import { createPostgresGoogleLink } from "./postgres-google-link.js";
import { createPostgresPasswordLink } from "./postgres-password-link.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

type AuthMethod = "google" | "password";

export interface PostgresFoundationIdentityOptions {
  clock: Clock;
  pepper: string;
  protectRefreshToken: (token: string) => string;
  secrets: SecretSource;
  sql: Sql;
  webOrigin: string;
}

export function createPostgresFoundationIdentity(options: PostgresFoundationIdentityOptions) {
  async function trusted<T>(operation: (sql: TransactionSql) => Promise<T>): Promise<T> {
    return options.sql.begin(async (sql) => {
      await sql`SET LOCAL ROLE huayi_context_setter`;
      return operation(sql);
    }) as Promise<T>;
  }
  const createWebSession = createPostgresWebSession(options, trusted);
  const signInMethods = createPostgresSignInMethods(options, trusted);
  const passwordReauthentication = createPostgresPasswordReauthentication(options, trusted);
  const googleReauthentication = createPostgresGoogleReauthentication(options, trusted);
  const googleLink = createPostgresGoogleLink(options, trusted);
  const passwordLink = createPostgresPasswordLink(options, trusted);
  async function requireClaimTicket(claimTicket: string) {
    const [claim] = await trusted(
      (sql) => sql<{ expires_at: Date | null }[]>`
      SELECT require_claim_ticket(${hashSecret(claimTicket, options.pepper)}) AS expires_at
    `,
    );
    if (claim?.expires_at === null || claim === undefined)
      throw new CloudFault("invitation_invalid", "The claim ticket is invalid.");
    return { expiresAt: claim.expires_at };
  }

  async function claimInvitation(token: string) {
    const claimTicket = opaqueSecret(options.secrets);
    const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
    const [result] = await trusted(
      (sql) => sql<{ id: string | null }[]>`
      SELECT claim_invitation(
        ${hashSecret(token, options.pepper)}, ${hashSecret(claimTicket, options.pepper)}, ${expiresAt}
      )::text AS id
    `,
    );
    if (result?.id === null || result === undefined) {
      throw new CloudFault("invitation_invalid", "The invitation is invalid or unavailable.");
    }
    return { claimTicket, expiresAt };
  }

  async function createAuthFlow(claimTicket: string) {
    const claim = await requireClaimTicket(claimTicket);
    const flowId = opaqueSecret(options.secrets);
    const [result] = await trusted(
      (sql) => sql<{ id: string | null }[]>`
      SELECT create_auth_flow(
        ${hashSecret(claimTicket, options.pepper)}, ${hashSecret(flowId, options.pepper)},
        ${claim.expiresAt}
      ) AS id
    `,
    );
    if (result?.id === null || result === undefined) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    return { expiresAt: claim.expiresAt, flowId };
  }

  async function createLoginAuthFlow() {
    const flowId = opaqueSecret(options.secrets);
    const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
    const [result] = await trusted(
      (sql) => sql<{ id: string | null }[]>`
      SELECT create_login_auth_flow(
        ${hashSecret(flowId, options.pepper)},${expiresAt}
      ) AS id
    `,
    );
    if (result?.id === null || result === undefined) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    return { expiresAt, flowId };
  }

  async function completeAuthFlow(flow: string, user: string, email: string, method: AuthMethod) {
    const [result] = await trusted(
      (sql) => sql<{ id: string | null }[]>`
      SELECT complete_auth_flow(
        ${hashSecret(flow, options.pepper)}, ${user}, ${email}, 'UTC', 5, ${method}
      )::text AS id
    `,
    );
    if (result?.id === null || result === undefined) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    return { userId: user };
  }

  async function authenticateWebSession(sessionId: string) {
    const [session] = await trusted(
      (sql) => sql<{ csrf_hash: string; reauthenticated_at: Date; user_id: string }[]>`
      SELECT user_id::text, csrf_hash, reauthenticated_at
      FROM authenticate_web_session(${hashSecret(sessionId, options.pepper)})
    `,
    );
    if (session === undefined)
      throw new CloudFault("authentication_required", "The Web session is invalid.");
    return session;
  }

  async function authenticateDataRightsSession(sessionId: string) {
    const [session] = await trusted(
      (sql) => sql<
        {
          access_scope: "data-rights" | "full";
          csrf_hash: string;
          reauthenticated_at: Date;
          user_id: string;
        }[]
      >`
      SELECT user_id::text,csrf_hash,reauthenticated_at,access_scope
      FROM authenticate_data_rights_session(${hashSecret(sessionId, options.pepper)})
    `,
    );
    if (session === undefined) {
      throw new CloudFault("authentication_required", "The data-rights session is invalid.");
    }
    return session;
  }

  async function pairingById(id: string) {
    const [pairing] = await trusted(
      (sql) =>
        sql<
          {
            expires_at: Date;
            id: string;
            status: "approved" | "consumed" | "expired" | "pending";
          }[]
        >`SELECT id::text, expires_at, status FROM get_extension_pairing(${id})`,
    );
    if (pairing === undefined) throw new CloudFault("not_found", "The pairing was not found.");
    return { expiresAt: pairing.expires_at, id: pairing.id, status: pairing.status };
  }

  return {
    ...googleReauthentication,
    ...passwordReauthentication,
    ...signInMethods,
    googleLink,
    passwordLink,
    async authenticateDataRightsMutation(sessionId: string, origin: string, csrfToken: string) {
      const session = await authenticateDataRightsSession(sessionId);
      if (
        origin !== options.webOrigin ||
        !secretMatches(csrfToken, session.csrf_hash, options.pepper)
      ) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      return {
        access: session.access_scope,
        reauthenticatedAt: session.reauthenticated_at,
        userId: session.user_id,
      };
    },
    async authenticateDataRightsSession(sessionId: string) {
      const session = await authenticateDataRightsSession(sessionId);
      return {
        access: session.access_scope,
        reauthenticatedAt: session.reauthenticated_at,
        userId: session.user_id,
      };
    },
    async authenticateExtension(token: string) {
      const [result] = await trusted(
        (sql) => sql<{ user_id: string | null }[]>`
        SELECT authenticate_extension_session(${hashSecret(token, options.pepper)})::text AS user_id
      `,
      );
      if (result?.user_id === null || result === undefined) {
        throw new CloudFault("authentication_required", "The Extension session is invalid.");
      }
      return { userId: result.user_id };
    },
    async approveExtensionPairing(
      id: string,
      userId: string,
      input: ApproveExtensionPairingRequest,
    ) {
      try {
        const [result] = await trusted(
          (sql) => sql<{ id: string | null }[]>`
          SELECT approve_extension_pairing(
            ${id},${userId},${input.deviceLabel},${input.expectedPreferencesRevision},
            ${input.extensionQueryModelMode},${input.studyCaptureMode},${input.cloudWordCopyMode}
          )::text AS id
        `,
        );
        if (result?.id === null || result === undefined)
          throw new CloudFault("not_found", "Pairing unavailable.");
      } catch (error) {
        if (error instanceof CloudFault) throw error;
        if (error instanceof Error && error.message.includes("revision conflict")) {
          throw new CloudFault("revision_conflict", "The preferences revision has changed.");
        }
        throw error;
      }
    },
    async authenticateWebMutation(sessionId: string, origin: string, csrfToken: string) {
      const session = await authenticateWebSession(sessionId);
      if (
        origin !== options.webOrigin ||
        !secretMatches(csrfToken, session.csrf_hash, options.pepper)
      ) {
        throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
      }
      return { reauthenticatedAt: session.reauthenticated_at, userId: session.user_id };
    },
    async authenticateWebSession(sessionId: string) {
      const session = await authenticateWebSession(sessionId);
      return { reauthenticatedAt: session.reauthenticated_at, userId: session.user_id };
    },
    async bindInvitationIdentity(claimTicket: string, userId: string) {
      const [result] = await trusted(
        (sql) => sql<{ id: string | null }[]>`
        SELECT bind_auth_identity(${hashSecret(claimTicket, options.pepper)}, ${userId})::text AS id
      `,
      );
      if (result?.id === null || result === undefined)
        throw new CloudFault("invitation_invalid", "Invalid claim.");
    },
    claimInvitation,
    completeAuthFlow,
    async consumeAuthFlow(flowId: string) {
      const [result] = await trusted(
        (sql) => sql<{ ticket: string | null }[]>`
        SELECT consume_auth_flow(${hashSecret(flowId, options.pepper)}) AS ticket
      `,
      );
      if (result?.ticket === null || result === undefined)
        throw new CloudFault("authentication_required", "Invalid flow.");
      return result.ticket;
    },
    createAuthFlow,
    createLoginAuthFlow,
    async createExtensionPairing(command: {
      installIdHash: string;
      pkceChallenge: string;
      state: string;
    }) {
      const id = crypto.randomUUID();
      const expiresAt = addMilliseconds(options.clock.now(), 10 * 60 * 1_000);
      await trusted(
        (sql) => sql`SELECT create_extension_pairing(
        ${id}, ${hashSecret(command.state, options.pepper)}, ${command.pkceChallenge},
        ${command.installIdHash}, ${expiresAt}
      )`,
      );
      return { expiresAt, id, status: "pending" as const };
    },
    createWebSession,
    async exchangeExtensionPairing(id: string, state: string, verifier: string) {
      const sessionId = crypto.randomUUID();
      const sessionToken = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 90 * 24 * 60 * 60 * 1_000);
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const [result] = await trusted(
        (sql) => sql<
          {
            cloud_word_copy_mode: "disabled" | "enabled";
            extension_query_model_mode: "byok" | "platform";
            id: string;
            preferences_revision: number;
            preferences_updated_at: Date;
            study_capture_mode: "automatic" | "manual";
          }[]
        >`
        SELECT id::text,extension_query_model_mode,study_capture_mode,
          cloud_word_copy_mode,preferences_revision,preferences_updated_at
        FROM exchange_extension_pairing(
          ${id}, ${hashSecret(state, options.pepper)}, ${challenge}, ${sessionId},
          ${hashSecret(sessionToken, options.pepper)}, ${expiresAt}
        )
      `,
      );
      if (result === undefined) throw new CloudFault("forbidden", "Invalid pairing.");
      const snapshot: ExtensionPreferences = {
        cloudWordCopyMode: result.cloud_word_copy_mode,
        extensionQueryModelMode: result.extension_query_model_mode,
        revision: result.preferences_revision,
        studyCaptureMode: result.study_capture_mode,
        updatedAt: result.preferences_updated_at.toISOString(),
      };
      return { expiresAt, preferences: snapshot, sessionId, sessionToken };
    },
    getExtensionPairing: pairingById,
    async listExtensionSessions(userId: string) {
      return trusted(
        (sql) => sql<
          {
            created_at: Date;
            device_label: string;
            expires_at: Date;
            id: string;
            last_used_at: Date | null;
          }[]
        >`
        SELECT id::text, device_label, created_at, last_used_at, expires_at
        FROM list_extension_sessions(${userId})
      `,
      ).then((sessions) =>
        sessions.map((session) => ({
          createdAt: session.created_at,
          deviceLabel: session.device_label,
          expiresAt: session.expires_at,
          id: session.id,
          lastUsedAt: session.last_used_at,
        })),
      );
    },
    requireClaimTicket,
    async readAuthFlowState(flowId: string) {
      const [result] = await trusted(
        (sql) => sql<{ state: string | null }[]>`
        SELECT read_auth_flow_state(${hashSecret(flowId, options.pepper)}) AS state
      `,
      );
      if (result?.state === null || result === undefined) {
        throw new CloudFault("authentication_required", "The authentication flow is invalid.");
      }
      return result.state;
    },
    async revokeExtensionSession(userId: string, sessionId: string) {
      const [result] = await trusted(
        (sql) => sql<{ revoked: boolean | null }[]>`
        SELECT revoke_extension_session(${userId}, ${sessionId}) AS revoked
      `,
      );
      if (result?.revoked !== true) throw new CloudFault("not_found", "Device session not found.");
    },
    async revokeWebSession(sessionId: string) {
      await trusted(
        (sql) => sql`SELECT revoke_web_session(${hashSecret(sessionId, options.pepper)})`,
      );
    },
    async rotateWebCsrf(sessionId: string) {
      const session = await authenticateDataRightsSession(sessionId);
      const csrfToken = opaqueSecret(options.secrets);
      const [result] = await trusted(
        (sql) => sql<{ rotated: boolean | null }[]>`
        SELECT rotate_web_csrf(
          ${hashSecret(sessionId, options.pepper)}, ${hashSecret(csrfToken, options.pepper)}
        ) AS rotated
      `,
      );
      if (result?.rotated !== true) {
        throw new CloudFault("authentication_required", "The Web session is invalid.");
      }
      return { access: session.access_scope, csrfToken };
    },
    async saveAuthFlowState(flowId: string, state: string) {
      const [result] = await trusted(
        (sql) => sql<{ saved: boolean | null }[]>`
        SELECT save_auth_flow_state(${hashSecret(flowId, options.pepper)}, ${state}) AS saved
      `,
      );
      if (result?.saved !== true) {
        throw new CloudFault("authentication_required", "The authentication flow is invalid.");
      }
    },
  };
}
