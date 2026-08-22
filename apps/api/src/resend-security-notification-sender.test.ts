import { describe, expect, it, vi } from "vitest";

import { createResendSecurityNotificationSender } from "./resend-security-notification-sender.js";

describe("Resend security notification sender", () => {
  it("uses the fixed HTTPS endpoint, template, and notification idempotency key", async () => {
    const requests: { init: RequestInit; input: string }[] = [];
    const fetch = vi.fn(async (input: string, init: RequestInit) => {
      requests.push({ init, input });
      return new Response(JSON.stringify({ id: "provider-message" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    const sender = createResendSecurityNotificationSender({
      apiKey: "re_test-only-not-a-real-secret",
      fetch,
      from: "语见 <security@notify.example.test>",
      replyTo: "support@example.test",
    });

    await sender.sendPasswordResetCompleted({
      email: "learner@example.test",
      idempotencyKey: "32000000-0000-0000-0000-000000000001",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = requests[0];
    expect(request?.input).toBe("https://api.resend.com/emails");
    expect(request?.init).toMatchObject({ credentials: "omit", method: "POST", redirect: "error" });
    expect(request?.init.headers).toEqual({
      Authorization: "Bearer re_test-only-not-a-real-secret",
      "Content-Type": "application/json",
      "Idempotency-Key": "32000000-0000-0000-0000-000000000001",
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      from: "语见 <security@notify.example.test>",
      html: expect.stringContaining("密码已重置"),
      reply_to: "support@example.test",
      subject: "语见安全通知：密码已重置",
      text: expect.stringContaining("密码已重置"),
      to: ["learner@example.test"],
    });
  });

  it("maps provider failures to one fixed error without exposing response or credentials", async () => {
    const fetch = vi.fn(async () => new Response("private provider error", { status: 429 }));
    const sender = createResendSecurityNotificationSender({
      apiKey: "re_private-key-must-not-escape",
      fetch,
      from: "语见 <security@notify.example.test>",
      replyTo: "support@example.test",
    });

    await expect(
      sender.sendPasswordResetCompleted({
        email: "learner@example.test",
        idempotencyKey: "32000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow("Security notification delivery failed.");
    await expect(
      sender.sendPasswordResetCompleted({
        email: "learner@example.test",
        idempotencyKey: "32000000-0000-0000-0000-000000000001",
      }),
    ).rejects.not.toThrow("private provider error");
    await expect(
      sender.sendPasswordResetCompleted({
        email: "learner@example.test",
        idempotencyKey: "32000000-0000-0000-0000-000000000001",
      }),
    ).rejects.not.toThrow("re_private-key-must-not-escape");
  });
});
