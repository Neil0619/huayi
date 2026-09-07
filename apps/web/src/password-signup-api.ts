import {
  passwordLoginResponseSchema,
  passwordRegistrationResendResponseSchema,
  passwordSignupCompleteRequestSchema,
  passwordSignupHttpRoutes,
  passwordSignupSessionResponseSchema,
  passwordSignupStartRequestSchema,
  passwordSignupVerifyRequestSchema,
} from "@huayi/cloud-contracts";

export function createWebPasswordSignupApi(
  request: (path: string, init?: RequestInit) => Promise<Response>,
) {
  const post = (path: string, body: unknown, csrfToken?: string) =>
    request(path, {
      body: JSON.stringify(body),
      credentials: "include",
      method: "POST",
      referrerPolicy: "no-referrer",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken === undefined
          ? {}
          : {
              "X-CSRF-Token": passwordSignupSessionResponseSchema.shape.csrfToken.parse(csrfToken),
            }),
      },
    });
  return {
    async startPasswordSignup(claimTicket: string, email: string) {
      const response = await post(
        passwordSignupHttpRoutes.start,
        passwordSignupStartRequestSchema.parse({ claimTicket, email }),
      );
      return passwordSignupSessionResponseSchema.parse(await response.json());
    },
    async getPasswordSignupSession() {
      const response = await request(passwordSignupHttpRoutes.session, {
        credentials: "include",
        headers: { Accept: "application/json" },
        referrerPolicy: "no-referrer",
      });
      return passwordSignupSessionResponseSchema.parse(await response.json());
    },
    async verifyPasswordSignup(token: string, csrfToken: string) {
      const response = await post(
        passwordSignupHttpRoutes.verify,
        passwordSignupVerifyRequestSchema.parse({ token }),
        csrfToken,
      );
      return passwordSignupSessionResponseSchema.parse(await response.json());
    },
    async resendPasswordSignup(csrfToken: string) {
      const response = await post(passwordSignupHttpRoutes.resend, {}, csrfToken);
      return passwordRegistrationResendResponseSchema.parse(await response.json());
    },
    async completePasswordSignup(password: string, csrfToken: string) {
      const response = await post(
        passwordSignupHttpRoutes.complete,
        passwordSignupCompleteRequestSchema.parse({ password }),
        csrfToken,
      );
      return passwordLoginResponseSchema.parse(await response.json());
    },
  };
}

export type PasswordSignupApi = ReturnType<typeof createWebPasswordSignupApi>;
