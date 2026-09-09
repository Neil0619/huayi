import {
  csrfTokenResponseSchema,
  miniProgramBindingApprovalSchema,
  miniProgramRoutes,
} from "@huayi/cloud-contracts";

export function createWebWechatBindingApi(
  request: (path: string, init?: RequestInit) => Promise<Response>,
) {
  return {
    async approveWechatBinding(bindingCode: string, csrfToken: string): Promise<void> {
      const input = miniProgramBindingApprovalSchema.parse({ bindingCode, confirmed: true });
      const csrf = csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken;
      await request(miniProgramRoutes.approveBinding, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(input),
      });
    },
  };
}
