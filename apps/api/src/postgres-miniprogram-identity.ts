import {
  miniProgramAccountSchema,
  miniProgramLoginResponseSchema,
  miniProgramSessionSchema,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { MiniProgramIdentity } from "./miniprogram-identity.js";
import { hashSecret, opaqueSecret, systemSecrets } from "./security.js";

export function createPostgresMiniProgramIdentity(options: {
  database: AnalysisDatabase;
  pepper: string;
}): MiniProgramIdentity {
  const hash = (value: string) => hashSecret(value, options.pepper);
  const subject = (appId: string, openId: string) => hash(`wechat:${appId}:${openId}`);
  const call = async (statement: string, parameters: readonly unknown[]): Promise<unknown> =>
    options.database.trusted(
      async (query) => (await query.rows<{ value: unknown }>(statement, parameters))[0]?.value,
    );
  const required = (value: unknown) => {
    if (value !== true)
      throw new CloudFault("authentication_required", "The identity proof is invalid or expired.");
  };
  return {
    async begin(proof) {
      const ticket = opaqueSecret(systemSecrets);
      const token = opaqueSecret(systemSecrets);
      const bindingCode = Buffer.from(systemSecrets.bytes(5)).toString("hex").toUpperCase();
      const value = await call("SELECT begin_wechat_login($1,$2,$3,$4,$5,$6) AS value", [
        proof.appId,
        subject(proof.appId, proof.openId),
        hash(ticket),
        hash(bindingCode),
        crypto.randomUUID(),
        hash(token),
      ]);
      if (typeof value !== "object" || value === null)
        throw new CloudFault("authentication_required", "WeChat login is unavailable.");
      return miniProgramLoginResponseSchema.parse(
        "state" in value && value.state === "authenticated"
          ? { ...value, token }
          : { ...value, ticket, bindingCode },
      );
    },
    async onboard(ticket, mode) {
      const token = opaqueSecret(systemSecrets);
      const value = await call("SELECT complete_wechat_onboarding($1,$2,$3,$4,$5) AS value", [
        hash(ticket),
        mode,
        crypto.randomUUID(),
        crypto.randomUUID(),
        hash(token),
      ]);
      if (typeof value !== "object" || value === null)
        throw new CloudFault(
          "authentication_required",
          "The onboarding proof is invalid or already used.",
        );
      return miniProgramSessionSchema.parse({ ...value, token });
    },
    async bindingStatus(ticket) {
      const status = await call("SELECT wechat_binding_status($1) AS value", [hash(ticket)]);
      return { status: status === "pending" || status === "approved" ? status : "expired" };
    },
    async loginAndLink(ticket, authenticatedUserId) {
      const token = opaqueSecret(systemSecrets);
      const value = await call("SELECT complete_wechat_password_binding($1,$2,$3,$4) AS value", [
        hash(ticket),
        authenticatedUserId,
        crypto.randomUUID(),
        hash(token),
      ]);
      if (typeof value !== "object" || value === null)
        throw new CloudFault(
          "authentication_required",
          "Account login or linking could not be completed.",
        );
      return miniProgramSessionSchema.parse({ ...value, token });
    },
    async approveBinding(code, webSessionHash, userId) {
      required(
        await call("SELECT approve_wechat_binding($1,$2,$3) AS value", [
          hash(code),
          webSessionHash,
          userId,
        ]),
      );
    },
    async authenticate(token) {
      const sessionHash = hash(token);
      const value = await call("SELECT authenticate_miniprogram_session($1) AS value", [
        sessionHash,
      ]);
      if (
        typeof value !== "object" ||
        value === null ||
        !("userId" in value) ||
        typeof value.userId !== "string" ||
        !("reauthenticatedAt" in value)
      )
        throw new CloudFault(
          "authentication_required",
          "A valid mini-program session is required.",
        );
      return {
        userId: value.userId,
        sessionHash,
        reauthenticatedAt:
          value.reauthenticatedAt === null
            ? new Date(0)
            : new Date(String(value.reauthenticatedAt)),
      };
    },
    async reauthenticate(token, proof) {
      required(
        await call("SELECT reauthenticate_miniprogram_session($1,$2,$3) AS value", [
          hash(token),
          proof.appId,
          subject(proof.appId, proof.openId),
        ]),
      );
    },
    async revoke(token) {
      await call("SELECT revoke_miniprogram_session($1) AS value", [hash(token)]);
    },
    async account(userId) {
      return options.database.transaction(userId, async ({ tenant }) => {
        const row = (
          await tenant.rows<{ user_id: string; email: string | null }>(
            "SELECT user_id::text,email FROM user_profiles WHERE user_id=$1 AND status='active'",
            [userId],
          )
        )[0];
        if (!row) throw new CloudFault("not_found", "Account not found.");
        return miniProgramAccountSchema.parse({
          id: row.user_id,
          email: row.email,
          linkedToWeb: row.email !== null,
        });
      });
    },
  };
}
