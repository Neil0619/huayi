import { describe, expect, it } from "vitest";

import { createIdentityModule } from "./identity-module.js";
import { hashSecret, webSessionCsrfToken } from "./security.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const origin = "https://app.huayi.example";
const pepper = "csrf-test-pepper-at-least-32-characters";

describe("session-bound Web CSRF proof", () => {
  it.each(["active", "disabled"] as const)(
    "supports parallel bootstrap for %s sessions",
    (status) => {
      const clock = new MutableClock("2026-09-07T00:00:00Z");
      const identity = createIdentityModule({
        clock,
        pepper,
        secrets: new DeterministicSecrets(),
        webOrigin: origin,
      });
      identity.createProfile("user", "user@example.test", ["password"]);
      identity.setAccountStatus("user", status);
      const session = identity.createWebSession("user", "encrypted-refresh");
      const proofs = [
        session,
        identity.bootstrapWebCsrf(session.sessionId),
        identity.bootstrapWebCsrf(session.sessionId),
      ];
      for (const proof of proofs) {
        expect(
          identity.authenticateDataRightsMutation(session.sessionId, origin, proof.csrfToken),
        ).toMatchObject({ userId: "user", access: status === "active" ? "full" : "data-rights" });
        expect(() =>
          identity.authenticateDataRightsMutation(
            session.sessionId,
            "https://evil.example",
            proof.csrfToken,
          ),
        ).toThrowError(expect.objectContaining({ code: "forbidden" }));
      }
      identity.revokeWebSession(session.sessionId);
      expect(() => identity.bootstrapWebCsrf(session.sessionId)).toThrowError(
        expect.objectContaining({ code: "authentication_required" }),
      );
    },
  );

  it("separates proof from session identifiers, lookup hashes, and other environments", () => {
    const session = "random-session-secret-at-least-32-characters";
    const proof = webSessionCsrfToken(session, pepper);
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(proof).not.toBe(session);
    expect(proof).not.toBe(hashSecret(session, pepper));
    expect(proof).not.toBe(webSessionCsrfToken("another-session", pepper));
    expect(proof).not.toBe(webSessionCsrfToken(session, "another-environment-pepper"));
  });
});
