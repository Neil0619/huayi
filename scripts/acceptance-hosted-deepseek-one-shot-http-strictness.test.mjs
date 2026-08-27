import assert from "node:assert/strict";
import test from "node:test";

import { hostedDeepSeekAnalysisRequestBody } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import { createHostedDeepSeekNormalWebHttpTransport } from "./acceptance-hosted-deepseek-one-shot-http-transport.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;
const control = Object.freeze({
  applicationBudgetMilliseconds: 90_000,
  deadlineAt: Date.parse("2026-08-27T08:01:30.000Z"),
  signal: new AbortController().signal,
});

function credentials() {
  return Object.freeze({ email: "operator@example.com", password: "password-0001" });
}

function applicationRequest(overrides = {}) {
  return Object.freeze({
    body: hostedDeepSeekAnalysisRequestBody,
    deployments: Object.freeze({ api: {}, web: {} }),
    idempotencyKey: "hosted-deepseek-one-shot-001",
    operationId: "20000000-0000-4000-8000-000000000002",
    origin: "https://app.acceptance.seen-said.cn",
    ownerId: "10000000-0000-4000-8000-000000000001",
    path: "/v1/analyses:stream",
    ...overrides,
  });
}

test("endpoint and analysis body overrides fail before fetch", async () => {
  assert.throws(
    () =>
      createHostedDeepSeekNormalWebHttpTransport({
        apiOrigin: "https://attacker.invalid",
        credentials: credentials(),
        fetch_: async () => new Response(),
        readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
      }),
    failurePattern,
  );

  let calls = 0;
  const transport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async () => {
      calls += 1;
      return new Response();
    },
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
  });
  await assert.rejects(
    transport.invokeCloudWebAnalysis(
      { cookie: `huayi_session=${"n".repeat(32)}`, csrfToken: "r".repeat(32) },
      applicationRequest({
        body: { ...hostedDeepSeekAnalysisRequestBody, sourceText: "override" },
      }),
      control,
    ),
    failurePattern,
  );
  assert.equal(calls, 0);
});

test("non-UUID started request IDs fail before constructing a status route", async () => {
  const calls = [];
  const transport = createHostedDeepSeekNormalWebHttpTransport({
    credentials: credentials(),
    fetch_: async (input, init = {}) => {
      calls.push(`${init.method}:${new URL(String(input)).pathname}`);
      return new Response(
        `event: analysis\nid: 1\ndata: ${JSON.stringify({
          requestId: "..",
          type: "analysis.started",
          unitCount: 1,
        })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
    readNowMilliseconds: () => Date.parse("2026-08-27T08:00:00.000Z"),
  });

  await assert.rejects(
    transport.invokeCloudWebAnalysis(
      { cookie: `huayi_session=${"n".repeat(32)}`, csrfToken: "r".repeat(32) },
      applicationRequest(),
      control,
    ),
    failurePattern,
  );
  assert.deepEqual(calls, ["POST:/v1/analyses:stream"]);
});
