import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPracticeTeachingApp } from "./practice-teaching-app.js";
import { authenticateLearningAccountRequest } from "./miniprogram-authentication.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import {
  createPracticeTeachingFixture,
  practiceOwner,
  practiceOther,
} from "./test-support/practice-teaching-fixture.js";

let fixture: Awaited<ReturnType<typeof createPracticeTeachingFixture>>;
let app: Hono;
beforeEach(async () => {
  fixture = await createPracticeTeachingFixture();
  const identity = {
    async authenticateWebSession(cookie: string) {
      return { userId: cookie === "other" ? practiceOther : practiceOwner };
    },
    async authenticateWebMutation(_cookie: string, origin: string, csrf: string) {
      if (origin !== "https://app.example.test" || csrf !== "proof")
        throw new CloudFault("forbidden", "Invalid proof.");
      return { userId: practiceOwner };
    },
    async authenticateExtension() {
      throw new CloudFault("forbidden", "Not a learning client.");
    },
    async authenticateMiniProgram() {
      return { userId: practiceOwner };
    },
  };
  app = new Hono();
  app.onError((error, context) => {
    const fault =
      error instanceof CloudFault ? error : new CloudFault("invalid_request", "Invalid request.");
    return context.json({ error: { code: fault.code } }, errorStatus(fault.code));
  });
  app.route(
    "/",
    createPracticeTeachingApp({
      teaching: fixture.teaching,
      authenticate: (context) => authenticateLearningAccountRequest(identity, context),
    }),
  );
});
afterEach(async () => fixture?.db.close());

it("serves owner-scoped, non-cacheable teaching details for Web and mini-program readers", async () => {
  const session = await fixture.begin();
  const path = `/v2/practice/sessions/${session.id}/teaching`;
  expect((await app.request(path)).status).toBe(401);
  const response = await app.request(path, { headers: { cookie: "huayi_session=current" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    version: 1,
    session: { id: session.id },
    teaching: { contract: "practice-teaching-v1" },
  });
  expect((await app.request(path, { headers: { cookie: "huayi_session=other" } })).status).toBe(
    404,
  );
  expect(
    (await app.request(path, { headers: { authorization: `HuayiMiniProgram ${"a".repeat(43)}` } }))
      .status,
  ).toBe(200);
});

it("requires CSRF, idempotency and a strict server-timestamped action before changing state", async () => {
  const session = await fixture.begin();
  const path = `/v2/practice/sessions/${session.id}/teaching-actions`;
  const body = {
    action: "reveal-hint",
    expectedRevision: session.revision,
    expectedControlRevision: 0,
    ordinal: 0,
  };
  const headers = {
    cookie: "huayi_session=current",
    origin: "https://app.example.test",
    "x-csrf-token": "proof",
    "content-type": "application/json",
    "idempotency-key": "hint",
  };
  expect(
    (
      await app.request(path, {
        method: "POST",
        headers: { cookie: headers.cookie },
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request(path, {
        method: "POST",
        headers: { ...headers, "x-csrf-token": "wrong" },
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(403);
  const withoutKey = new Headers(headers);
  withoutKey.delete("idempotency-key");
  expect(
    (await app.request(path, { method: "POST", headers: withoutKey, body: JSON.stringify(body) }))
      .status,
  ).toBe(400);
  expect(
    (
      await app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, hintViewedAt: "2026-01-01T00:00:00Z" }),
      })
    ).status,
  ).toBe(400);
  expect(
    (await fixture.teaching.get(practiceOwner, session.id)).teaching?.round.hintViewedAt,
  ).toBeNull();
  expect(
    (await app.request(path, { method: "POST", headers, body: JSON.stringify(body) })).status,
  ).toBe(200);
});
