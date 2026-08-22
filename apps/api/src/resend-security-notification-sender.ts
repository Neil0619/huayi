import { accountEmailSchema, resourceIdSchema } from "@huayi/cloud-contracts";

import type { SecurityNotificationSender } from "./security-notification-worker.js";

export const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

const subject = "语见安全通知：密码已重置";
const text = `你的语见账号密码已重置。

如果这是你本人操作，无需采取其他行动。如果不是你本人操作，请立即通过支持邮箱联系我们。`;
const html = `<p>你的语见账号密码已重置。</p><p>如果这是你本人操作，无需采取其他行动。如果不是你本人操作，请立即通过支持邮箱联系我们。</p>`;

export type SecurityNotificationFetch = (input: string, init: RequestInit) => Promise<Response>;

export function createResendSecurityNotificationSender(options: {
  apiKey: string;
  fetch: SecurityNotificationFetch;
  from: string;
  replyTo: string;
}): SecurityNotificationSender {
  return {
    async sendPasswordResetCompleted(command) {
      const email = accountEmailSchema.parse(command.email);
      const idempotencyKey = resourceIdSchema.parse(command.idempotencyKey);
      let response: Response;
      try {
        response = await options.fetch(RESEND_EMAIL_ENDPOINT, {
          body: JSON.stringify({
            from: options.from,
            html,
            reply_to: options.replyTo,
            subject,
            text,
            to: [email],
          }),
          credentials: "omit",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new Error("Security notification delivery failed.");
      }
      if (!response.ok) throw new Error("Security notification delivery failed.");
    },
  };
}
