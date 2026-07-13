import assert from "node:assert/strict";
import test from "node:test";

import { encodeNativeMessage } from "./native-host-smoke-client.mjs";
import {
  FakeChild,
  closeClient,
  createClient,
  endStdout,
} from "./native-host-smoke-test-support.mjs";

function analyzeRequest(requestId) {
  return { requestId, type: "analyze" };
}

function analysisDelta(requestId, sequence) {
  return {
    delta: `delta-${sequence}`,
    requestId,
    section: "translation",
    sequence,
    type: "analysis-delta",
  };
}

async function closeFatalClient(client, child, fatalError) {
  const closing = client.close();
  await endStdout(child);
  child.completeExit();
  await assert.rejects(closing, (error) => error === fatalError);
}

export function registerStreamingSmokeTests() {
  test("native host client waits through exact ordered deltas for the final result", async () => {
    const child = new FakeChild();
    const client = createClient(child);
    const requestId = "streaming-result";
    let settled = false;
    const response = client.request(analyzeRequest(requestId), "result", 1_000);
    void response.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    child.stdout.write(encodeNativeMessage(analysisDelta(requestId, 0)));
    child.stdout.write(encodeNativeMessage(analysisDelta(requestId, 1)));
    await new Promise((resolveWait) => setImmediate(resolveWait));
    assert.equal(settled, false);

    child.stdout.write(
      encodeNativeMessage({ requestId, result: { kind: "final" }, type: "result" }),
    );
    const event = await response;
    assert.deepEqual(event.result, { kind: "final" });
    assert.equal(event.deltaCount, 2);
    assert.ok(Number.isFinite(event.firstDeltaAt));
    assert.ok(event.fullResultAt >= event.firstDeltaAt);
    await closeClient(client, child);
  });

  test("native host client rejects a skipped analysis delta sequence", async () => {
    const child = new FakeChild();
    const client = createClient(child);
    const requestId = "skipped-delta";
    const response = client.request(analyzeRequest(requestId), "result", 1_000);

    child.stdout.write(encodeNativeMessage(analysisDelta(requestId, 1)));

    let fatalError;
    await assert.rejects(response, (error) => {
      fatalError = error;
      return error instanceof Error && /expected analysis delta sequence 0/i.test(error.message);
    });
    await closeFatalClient(client, child, fatalError);
  });

  for (const [requestType, expectedType] of [
    ["health", "health-result"],
    ["check-word", "word-status"],
  ]) {
    test(`native host client rejects an analysis delta in the ${requestType} lane`, async () => {
      const child = new FakeChild();
      const client = createClient(child);
      const requestId = `${requestType}-delta`;
      const response = client.request({ requestId, type: requestType }, expectedType, 1_000);

      child.stdout.write(encodeNativeMessage(analysisDelta(requestId, 0)));

      let fatalError;
      await assert.rejects(response, (error) => {
        fatalError = error;
        return error instanceof Error && /analysis delta is invalid for/i.test(error.message);
      });
      await closeFatalClient(client, child, fatalError);
    });
  }

  test("native host client latches a delta after the final terminal", async () => {
    const child = new FakeChild();
    const client = createClient(child);
    const requestId = "late-delta";
    const response = client.request(analyzeRequest(requestId), "result", 1_000);
    child.stdout.write(encodeNativeMessage(analysisDelta(requestId, 0)));
    child.stdout.write(encodeNativeMessage({ requestId, result: {}, type: "result" }));
    await response;

    child.stdout.write(encodeNativeMessage(analysisDelta(requestId, 1)));

    let fatalError;
    await assert.rejects(
      client.request({ requestId: "future-request" }, "result", 1_000),
      (error) => {
        fatalError = error;
        return error instanceof Error && /unexpected event for late-delta/i.test(error.message);
      },
    );
    await closeFatalClient(client, child, fatalError);
  });
}
