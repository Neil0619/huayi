import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import { hostedDeepSeekAnalysisRequestBody } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import { createHostedDeepSeekNormalWebHttpTransport } from "./acceptance-hosted-deepseek-one-shot-http-transport.mjs";
import { createHostedDeepSeekNormalWebSessionAdapter } from "./acceptance-hosted-deepseek-one-shot-session.mjs";

const apiOrigin = "https://api.acceptance.seen-said.cn";
const webOrigin = "https://app.acceptance.seen-said.cn";
const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;
const oldCookie = `huayi_session=${"o".repeat(32)}`;
const replacementCookie = `huayi_session=${"n".repeat(32)}`;
const oldCsrf = "c".repeat(32);
const replacementCsrf = "r".repeat(32);
const requestId = "30000000-0000-4000-8000-000000000003";
const control = Object.freeze({
  applicationBudgetMilliseconds: 90_000,
  deadlineAt: Date.parse("2026-08-27T08:01:30.000Z"),
  signal: new AbortController().signal,
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    status,
  });
}

function sessionResponse(cookie, csrfToken) {
  return jsonResponse({ access: "full", csrfToken }, 200, {
    "Set-Cookie": `${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/`,
  });
}

function startedEvent(id = requestId) {
  return `event: analysis\nid: 1\ndata: ${JSON.stringify({
    requestId: id,
    type: "analysis.started",
    unitCount: 1,
  })}\n\n`;
}

function applicationRequest(overrides = {}) {
  return Object.freeze({
    body: hostedDeepSeekAnalysisRequestBody,
    deployments: Object.freeze({ api: {}, web: {} }),
    idempotencyKey: "hosted-deepseek-one-shot-001",
    operationId: "20000000-0000-4000-8000-000000000002",
    origin: webOrigin,
    ownerId: "10000000-0000-4000-8000-000000000001",
    path: "/v1/analyses:stream",
    ...overrides,
  });
}

function credentials() {
  return Object.freeze({ email: "operator@example.com", password: "password-0001" });
}

test("production HTTP transport uses only normal Web routes and rotated Cookie/CSRF", async () => {
  const calls = [];
  const fetch_ = async (input, init = {}) => {
    const url = String(input);
    calls.push({ init, url });
    assert.equal(init.redirect, "error");
    assert.equal(init.referrerPolicy, "no-referrer");
    if (url === `${apiOrigin}/v1/auth/password/login`) {
      assert.deepEqual(JSON.parse(init.body), credentials());
      assert.equal(init.headers.Origin, webOrigin);
      assert.equal(init.headers.Cookie, undefined);
      return sessionResponse(oldCookie, oldCsrf);
    }
    if (url === `${apiOrigin}/v1/auth/reauthenticate/password`) {
      assert.deepEqual(JSON.parse(init.body), { password: credentials().password });
      assert.equal(init.headers.Cookie, oldCookie);
      assert.equal(init.headers["X-CSRF-Token"], oldCsrf);
      assert.equal(init.headers.Origin, webOrigin);
      return sessionResponse(replacementCookie, replacementCsrf);
    }
    if (url === `${apiOrigin}/v1/admin/access`) {
      assert.equal(init.headers.Cookie, replacementCookie);
      assert.equal(init.headers.Origin, undefined);
      assert.equal(init.headers["X-CSRF-Token"], undefined);
      return jsonResponse({ role: "operator" });
    }
    if (url === `${apiOrigin}/v1/admin/runtime/model-kill-switch`) {
      assert.equal(init.headers.Cookie, replacementCookie);
      assert.equal(init.headers["X-CSRF-Token"], replacementCsrf);
      assert.equal(init.headers.Origin, webOrigin);
      assert.match(init.headers["Idempotency-Key"], /^[0-9a-f-]{36}$/u);
      const { enabled } = JSON.parse(init.body);
      return jsonResponse({ enabled, updatedAt: "2026-08-27T08:00:00.000Z" });
    }
    if (url === `${apiOrigin}/v1/analyses:stream`) {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Cookie, replacementCookie);
      assert.equal(init.headers.Origin, webOrigin);
      assert.equal(init.headers["X-CSRF-Token"], replacementCsrf);
      assert.equal(init.headers["Idempotency-Key"], applicationRequest().idempotencyKey);
      assert.deepEqual(JSON.parse(init.body), hostedDeepSeekAnalysisRequestBody);
      assert.equal(init.body.includes("ownerId"), false);
      assert.equal(init.body.includes("operationId"), false);
      assert.equal(init.body.includes("deployments"), false);
      return new Response(startedEvent(), {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    }
    if (url === `${apiOrigin}/v1/analysis-requests/${requestId}`) {
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Cookie, replacementCookie);
      assert.equal(init.headers.Origin, undefined);
      assert.equal(init.headers["X-CSRF-Token"], undefined);
      return jsonResponse({ analysisId: "analysis-1", requestId, state: "completed" });
    }
    if (url === `${apiOrigin}/v1/auth/logout`) {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Cookie, replacementCookie);
      assert.equal(init.headers.Origin, webOrigin);
      assert.equal(init.headers["X-CSRF-Token"], replacementCsrf);
      return new Response(null, {
        headers: {
          "Set-Cookie": "huayi_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        },
        status: 204,
      });
    }
    throw new Error(`Unexpected fake route: ${url}`);
  };
  const transport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_,
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
    randomUuid: () => "00000000-0000-4000-8000-000000000001",
  });
  const session = createHostedDeepSeekNormalWebSessionAdapter({ transport });

  assert.deepEqual(Object.keys(transport).sort(), [
    "invokeCloudWebAnalysis",
    "loginPassword",
    "logout",
    "readOperatorAuthorization",
    "reauthenticatePassword",
    "reconcileDispatchedRequest",
    "setModelKillSwitch",
  ]);
  assert.equal(JSON.stringify(transport).includes(credentials().email), false);
  assert.equal(JSON.stringify(transport).includes(credentials().password), false);
  assert.equal(JSON.stringify(transport).includes(oldCookie), false);
  assert.equal(JSON.stringify(transport).includes(replacementCsrf), false);
  assert.equal(inspect(transport).includes(credentials().email), false);
  assert.equal(inspect(transport).includes(credentials().password), false);

  await session.loginPassword(control);
  await session.reauthenticatePassword(control);
  assert.deepEqual(await session.readOperatorAuthorization(control), {
    access: "full",
    observedAt: "2026-08-27T08:00:00.000Z",
    operator: true,
    reauthenticatedAt: "2026-08-27T08:00:00.000Z",
  });
  await session.setModelKillSwitch(false, control);
  assert.deepEqual(await session.invokeCloudWebAnalysis(applicationRequest(), control), {
    requestId,
    type: "analysis.started",
  });
  await session.setModelKillSwitch(true, control);
  await session.logout(control);

  assert.deepEqual(
    calls.map(({ init, url }) => `${init.method}:${new URL(url).pathname}`),
    [
      "POST:/v1/auth/password/login",
      "POST:/v1/auth/reauthenticate/password",
      "GET:/v1/admin/access",
      "PUT:/v1/admin/runtime/model-kill-switch",
      "POST:/v1/analyses:stream",
      `GET:/v1/analysis-requests/${requestId}`,
      "PUT:/v1/admin/runtime/model-kill-switch",
      "POST:/v1/auth/logout",
    ],
  );
});

test("401 and 403 fail closed without body reflection or transparent retry", async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const privateBody = `private-${status}-credential-body`;
    const transport = createHostedDeepSeekNormalWebHttpTransport({
      credentials: credentials(),
      fetch_: async () => {
        calls += 1;
        return jsonResponse({ error: { message: privateBody } }, status);
      },
      readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
    });
    let message = "";
    try {
      await transport.loginPassword(control);
      assert.fail("Expected authentication failure.");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.equal(message, "Hosted Cloud Web DeepSeek one-shot failed closed.");
    assert.equal(message.includes(privateBody), false);
    assert.equal(calls, 1);
  }
});

test("redirect responses fail closed without following or retrying sensitive requests", async () => {
  let calls = 0;
  const transport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async (_input, init) => {
      calls += 1;
      assert.equal(init.redirect, "error");
      assert.equal(init.referrerPolicy, "no-referrer");
      return new Response(null, {
        headers: { Location: "https://redirect.invalid/collect" },
        status: 302,
      });
    },
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
  });

  await assert.rejects(transport.loginPassword(control), failurePattern);
  assert.equal(calls, 1);
});

test("SSE interruption after started performs one bounded normal status read and no second POST", async () => {
  const calls = [];
  const transport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      calls.push(`${init.method}:${path}`);
      if (path === "/v1/analyses:stream") {
        let delivered = false;
        const body = new ReadableStream({
          pull(controller) {
            if (!delivered) {
              delivered = true;
              controller.enqueue(new TextEncoder().encode(startedEvent()));
              return;
            }
            controller.error(new Error("private interrupted SSE body"));
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }
      return jsonResponse({ analysisId: "analysis-1", requestId, state: "completed" });
    },
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
  });

  assert.deepEqual(
    await transport.invokeCloudWebAnalysis(
      { cookie: replacementCookie, csrfToken: replacementCsrf },
      applicationRequest(),
      control,
    ),
    { requestId, type: "analysis.started" },
  );
  assert.deepEqual(calls, ["POST:/v1/analyses:stream", `GET:/v1/analysis-requests/${requestId}`]);
});

test("SSE interruption before started and oversized bodies fail closed without retry", async () => {
  for (const mode of ["interrupted", "oversized"]) {
    let calls = 0;
    const transport = createHostedDeepSeekNormalWebHttpTransport({
      credentials: credentials(),
      fetch_: async () => {
        calls += 1;
        if (mode === "oversized") {
          return new Response("x".repeat(2 * 1_024 * 1_024 + 1), {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("private stream failure"));
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
      readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
    });
    await assert.rejects(
      transport.invokeCloudWebAnalysis(
        { cookie: replacementCookie, csrfToken: replacementCsrf },
        applicationRequest(),
        control,
      ),
      failurePattern,
    );
    assert.equal(calls, 1, mode);
  }
});

test("expired deadlines, oversized JSON, and excessive SSE events fail closed", async () => {
  let deadlineCalls = 0;
  const deadlineTransport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async () => {
      deadlineCalls += 1;
      return sessionResponse(oldCookie, oldCsrf);
    },
    readNowMilliseconds: () => control.deadlineAt,
  });
  await assert.rejects(deadlineTransport.loginPassword(control), failurePattern);
  assert.equal(deadlineCalls, 0);

  let jsonCalls = 0;
  const jsonTransport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async () => {
      jsonCalls += 1;
      return new Response(JSON.stringify({ secret: "s".repeat(17 * 1_024) }), {
        headers: { "Content-Type": "application/json" },
      });
    },
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
  });
  await assert.rejects(jsonTransport.loginPassword(control), failurePattern);
  assert.equal(jsonCalls, 1);

  const previews = Array.from(
    { length: 256 },
    (_, index) =>
      `event: analysis\nid: ${index + 2}\ndata: ${JSON.stringify({
        requestId,
        section: "overall",
        text: "bounded",
        type: "analysis.preview",
      })}\n\n`,
  ).join("");
  let sseCalls = 0;
  const sseTransport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async () => {
      sseCalls += 1;
      return new Response(`${startedEvent()}${previews}`, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
  });
  await assert.rejects(
    sseTransport.invokeCloudWebAnalysis(
      { cookie: replacementCookie, csrfToken: replacementCsrf },
      applicationRequest(),
      control,
    ),
    failurePattern,
  );
  assert.equal(sseCalls, 1);
});

test("unavailable dispatch-before-bind reconciliation adds no public route", async () => {
  let calls = 0;
  const transport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async () => {
      calls += 1;
      throw new Error("must not fetch");
    },
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
  });

  await assert.rejects(
    transport.reconcileDispatchedRequest(
      { cookie: replacementCookie, csrfToken: replacementCsrf },
      {},
      control,
    ),
    failurePattern,
  );
  assert.equal(calls, 0);
});
