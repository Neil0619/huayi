import {
  csrfTokenResponseSchema,
  extensionSessionListResponseSchema,
  identityHttpRoutes,
} from "@huayi/cloud-contracts";

type Request = (path: string, init?: RequestInit) => Promise<Response>;

export function createWebExtensionSessionsApi(request: Request) {
  return {
    async listExtensionSessions() {
      const response = await request(identityHttpRoutes.extensionSessions, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return extensionSessionListResponseSchema.parse(await response.json());
    },
    async revokeExtensionSession(sessionId: string): Promise<void> {
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
        throw new TypeError("Extension session ID is invalid.");
      }
      // Another Web tab can rotate the shared session proof after this page loads.
      const response = await request(identityHttpRoutes.csrf, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const { csrfToken } = csrfTokenResponseSchema.parse(await response.json());
      await request(
        identityHttpRoutes.extensionSession.replace(":id", encodeURIComponent(sessionId)),
        {
          credentials: "include",
          headers: { "X-CSRF-Token": csrfToken },
          method: "DELETE",
        },
      );
    },
  };
}
