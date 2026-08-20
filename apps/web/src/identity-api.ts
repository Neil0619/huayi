import {
  apiErrorSchema,
  accountResourceSchema,
  accountSignInMethodsResponseSchema,
  accountPreferencesRequestSchema,
  accountPreferencesResponseSchema,
  accountDataExportJobResourceSchema,
  accountDataRightsHttpRoutes,
  accountDeletionResponseSchema,
  approveExtensionPairingRequestSchema,
  claimInvitationRequestSchema,
  claimInvitationResponseSchema,
  createAccountDataExportRequestSchema,
  csrfTokenResponseSchema,
  currentAccountDataExportResponseSchema,
  downloadAccountDataExportResponseSchema,
  extensionPairingResponseSchema,
  extensionSessionListResponseSchema,
  googleLinkStartRequestSchema,
  googleLinkStartResponseSchema,
  googleReauthenticationStartRequestSchema,
  googleReauthenticationStartResponseSchema,
  identityHttpRoutes,
  passwordLinkRequestSchema,
  passwordLinkResponseSchema,
  passwordLoginRequestSchema,
  passwordLoginResponseSchema,
  passwordRecoveryAcceptedResponseSchema,
  passwordRecoveryCompleteRequestSchema,
  passwordRecoveryHttpRoutes,
  passwordRecoverySessionResponseSchema,
  passwordRecoveryStartRequestSchema,
  passwordRegistrationRequestSchema,
  passwordRegistrationResponseSchema,
  passwordReauthenticationRequestSchema,
  passwordReauthenticationResponseSchema,
  quotaSummarySchema,
  retryAccountDataExportRequestSchema,
  type AccountPreferencesRequest,
  type ApproveExtensionPairingRequest,
  type ApiError,
} from "@huayi/cloud-contracts";

export class WebIdentityApiError extends Error {
  constructor(
    readonly code: ApiError["error"]["code"] | "unknown",
    readonly status: number,
  ) {
    super(`Huayi identity request failed with ${status}.`);
    this.name = "WebIdentityApiError";
  }
}

export interface WebIdentityApiOptions {
  readonly apiOrigin: string;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function pairingPath(route: string, pairingId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(pairingId)) throw new TypeError("Pairing ID is invalid.");
  return route.replace(":id", encodeURIComponent(pairingId));
}

function sessionPath(route: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
    throw new TypeError("Extension session ID is invalid.");
  }
  return route.replace(":id", encodeURIComponent(sessionId));
}

function resourcePath(route: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new TypeError("Resource ID is invalid.");
  return route.replace(":id", encodeURIComponent(id));
}

export function createWebIdentityApi(options: WebIdentityApiOptions) {
  const apiOrigin = new URL(options.apiOrigin);
  if (
    apiOrigin.protocol !== "https:" ||
    apiOrigin.username !== "" ||
    apiOrigin.password !== "" ||
    apiOrigin.pathname !== "/" ||
    apiOrigin.search !== "" ||
    apiOrigin.hash !== ""
  ) {
    throw new TypeError("Huayi API origin is invalid.");
  }
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await options.fetch(new URL(path, apiOrigin), init);
    if (response.ok) return response;
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    throw new WebIdentityApiError(
      parsed.success ? parsed.data.error.code : "unknown",
      response.status,
    );
  };
  return {
    async completePasswordRecovery(password: string, csrfToken: string): Promise<void> {
      const input = passwordRecoveryCompleteRequestSchema.parse({ password });
      const csrf = passwordRecoverySessionResponseSchema.shape.csrfToken.parse(csrfToken);
      await request(passwordRecoveryHttpRoutes.complete, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "POST",
      });
    },
    async createAccountDataExport(csrfToken: string) {
      const input = createAccountDataExportRequestSchema.parse({});
      const response = await request(accountDataRightsHttpRoutes.createExport, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-CSRF-Token": csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken,
        },
        method: "POST",
      });
      return accountDataExportJobResourceSchema.parse(await response.json());
    },
    async deleteAccount(csrfToken: string) {
      const response = await request(accountDataRightsHttpRoutes.deleteAccount, {
        body: JSON.stringify({ confirmation: "delete-account" }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-CSRF-Token": csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken,
        },
        method: "POST",
      });
      return accountDeletionResponseSchema.parse(await response.json());
    },
    async downloadAccountDataExport(exportId: string, csrfToken: string) {
      const response = await request(
        resourcePath(accountDataRightsHttpRoutes.downloadExport, exportId),
        {
          body: "{}",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken,
          },
          method: "POST",
        },
      );
      return downloadAccountDataExportResponseSchema.parse(await response.json());
    },
    async approvePairing(
      pairingId: string,
      input: ApproveExtensionPairingRequest,
      csrfToken: string,
    ): Promise<void> {
      const parsed = approveExtensionPairingRequestSchema.parse(input);
      await request(pairingPath(identityHttpRoutes.extensionPairingApprove, pairingId), {
        body: JSON.stringify(parsed),
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        method: "POST",
      });
    },
    async bootstrap() {
      const response = await request(identityHttpRoutes.csrf, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return csrfTokenResponseSchema.parse(await response.json());
    },
    async getAccountPreferences() {
      const response = await request(identityHttpRoutes.accountPreferences, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return accountPreferencesResponseSchema.parse(await response.json());
    },
    async getAccountSignInMethods() {
      const response = await request(identityHttpRoutes.accountSignInMethods, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return accountSignInMethodsResponseSchema.parse(await response.json());
    },
    async getAccount() {
      const response = await request(identityHttpRoutes.account, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return accountResourceSchema.parse(await response.json());
    },
    async getCurrentAccountDataExport() {
      const response = await request(accountDataRightsHttpRoutes.currentExport, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return currentAccountDataExportResponseSchema.parse(await response.json());
    },
    async claimInvitation(invitationToken: string) {
      const input = claimInvitationRequestSchema.parse({ invitationToken });
      const response = await request(identityHttpRoutes.claimInvitation, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        referrerPolicy: "no-referrer",
      });
      return claimInvitationResponseSchema.parse(await response.json());
    },
    async getPairing(pairingId: string) {
      const response = await request(pairingPath(identityHttpRoutes.extensionPairing, pairingId), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return extensionPairingResponseSchema.parse(await response.json());
    },
    async getPasswordRecoverySession() {
      const response = await request(passwordRecoveryHttpRoutes.session, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return passwordRecoverySessionResponseSchema.parse(await response.json());
    },
    async getQuota() {
      const response = await request(identityHttpRoutes.quota, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return quotaSummarySchema.parse(await response.json());
    },
    async linkPassword(password: string, csrfToken: string) {
      const input = passwordLinkRequestSchema.parse({ password });
      const csrf = csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken;
      const response = await request(identityHttpRoutes.passwordLink, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "POST",
      });
      return passwordLinkResponseSchema.parse(await response.json());
    },
    async listExtensionSessions() {
      const response = await request(identityHttpRoutes.extensionSessions, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return extensionSessionListResponseSchema.parse(await response.json());
    },
    async loginPassword(email: string, password: string) {
      const input = passwordLoginRequestSchema.parse({ email, password });
      const response = await request(identityHttpRoutes.passwordLogin, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return passwordLoginResponseSchema.parse(await response.json());
    },
    async reauthenticatePassword(password: string, csrfToken: string) {
      const input = passwordReauthenticationRequestSchema.parse({ password });
      const csrf = csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken;
      const response = await request(identityHttpRoutes.passwordReauthentication, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "POST",
      });
      return passwordReauthenticationResponseSchema.parse(await response.json());
    },
    async registerPassword(claimTicket: string, email: string, password: string) {
      const input = passwordRegistrationRequestSchema.parse({ claimTicket, email, password });
      const response = await request(identityHttpRoutes.passwordRegister, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return passwordRegistrationResponseSchema.parse(await response.json());
    },
    async requestPasswordRecovery(email: string) {
      const input = passwordRecoveryStartRequestSchema.parse({ email });
      const response = await request(passwordRecoveryHttpRoutes.start, {
        body: JSON.stringify(input),
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return passwordRecoveryAcceptedResponseSchema.parse(await response.json());
    },
    async retryAccountDataExport(exportId: string, expectedRevision: number, csrfToken: string) {
      const input = retryAccountDataExportRequestSchema.parse({ expectedRevision });
      const response = await request(
        resourcePath(accountDataRightsHttpRoutes.retryExport, exportId),
        {
          body: JSON.stringify(input),
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            "If-Match": `"${expectedRevision}"`,
            "X-CSRF-Token": csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken,
          },
          method: "POST",
        },
      );
      return accountDataExportJobResourceSchema.parse(await response.json());
    },
    async updateAccountPreferences(input: AccountPreferencesRequest, csrfToken: string) {
      const parsed = accountPreferencesRequestSchema.parse(input);
      const csrf = csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken;
      const response = await request(identityHttpRoutes.accountPreferences, {
        body: JSON.stringify(parsed),
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "PATCH",
      });
      return accountPreferencesResponseSchema.parse(await response.json());
    },
    async revokeExtensionSession(sessionId: string, csrfToken: string): Promise<void> {
      const csrf = csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken;
      await request(sessionPath(identityHttpRoutes.extensionSession, sessionId), {
        credentials: "include",
        headers: { "X-CSRF-Token": csrf },
        method: "DELETE",
      });
    },
    async startGoogleLink(csrfToken: string) {
      const input = googleLinkStartRequestSchema.parse({});
      const csrf = csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken;
      const response = await request(identityHttpRoutes.googleLinkStart, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "POST",
      });
      const result = googleLinkStartResponseSchema.parse(await response.json());
      return { continueUrl: new URL(result.continuePath, apiOrigin).toString() };
    },
    async startGoogleReauthentication(csrfToken: string) {
      const input = googleReauthenticationStartRequestSchema.parse({});
      const csrf = csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken;
      const response = await request(identityHttpRoutes.googleReauthenticationStart, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "POST",
      });
      const result = googleReauthenticationStartResponseSchema.parse(await response.json());
      return { continueUrl: new URL(result.continuePath, apiOrigin).toString() };
    },
    googleAuthStartUrl: new URL(identityHttpRoutes.googleAuthStart, apiOrigin).toString(),
    googleLoginStartUrl: new URL(identityHttpRoutes.googleLoginStart, apiOrigin).toString(),
  };
}

export type WebIdentityApi = ReturnType<typeof createWebIdentityApi>;
