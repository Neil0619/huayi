import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_TIMEOUT_MS,
  NativeMessageDecoder,
  createNativeHostSpawnOptions,
  encodeNativeMessage,
  resolveCodexHome,
  validateSmokeResult,
} from "./native-host-smoke-client.mjs";

function createParagraphRequest() {
  return {
    requestId: "smoke-paragraph",
    selection: "First line.\nSecond line.",
    selectionKind: "paragraph",
  };
}

test("native framing rejects an incomplete frame at EOF", () => {
  for (const trailingLength of [1, 2, 3]) {
    const decoder = new NativeMessageDecoder();
    decoder.push(Buffer.alloc(trailingLength, 1));
    assert.throws(() => decoder.finish(), /incomplete native message frame/i);
  }

  const incompletePayload = new NativeMessageDecoder();
  const completeFrame = encodeNativeMessage({ type: "incomplete" });
  incompletePayload.push(completeFrame.subarray(0, -1));
  assert.throws(() => incompletePayload.finish(), /incomplete native message frame/i);
});

test("native framing handles partial chunks and multiple frames", () => {
  const decoder = new NativeMessageDecoder();
  const first = encodeNativeMessage({ type: "first" });
  const second = encodeNativeMessage({ type: "second" });

  assert.deepEqual(decoder.push(first.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(Buffer.concat([first.subarray(2), second])), [
    { type: "first" },
    { type: "second" },
  ]);
});

test("CODEX_HOME rejects a relative path before snapshots or child launch", async () => {
  await assert.rejects(
    async () => resolveCodexHome("relative-codex-home", "/tmp/home"),
    /CODEX_HOME must be absolute/i,
  );
});

test("CODEX_HOME resolves once and is passed unchanged to a detached macOS host", () => {
  const defaultHome = resolveCodexHome(undefined, "/Users/smoke");
  const explicitHome = resolveCodexHome("/private/tmp/codex-home", "/Users/smoke");
  const options = createNativeHostSpawnOptions({
    codexExecutable: "/opt/bin/codex",
    codexHome: explicitHome,
    environment: { PATH: "/opt/bin" },
    platform: "darwin",
    schemaDirectory: "/repo/schemas",
    workingDirectory: "/private/tmp/work",
  });

  assert.equal(defaultHome, join("/Users/smoke", ".codex"));
  assert.equal(explicitHome, "/private/tmp/codex-home");
  assert.equal(options.detached, true);
  assert.equal(options.env.CODEX_HOME, explicitHome);
});

test("health timeout exceeds four sequential ten-second capability probes", () => {
  assert.ok(HEALTH_TIMEOUT_MS >= 50_000);
});

test("paragraph smoke validation rejects a translation without a newline", () => {
  const request = createParagraphRequest();
  assert.throws(
    () =>
      validateSmokeResult(request, {
        selectionKind: "paragraph",
        sourceText: request.selection,
        translationZh: "First sentence. Second sentence.",
        type: "translate-passage",
      }),
    /did not preserve its line break/i,
  );
});

test("paragraph smoke validation accepts and preserves a translated newline", () => {
  const request = createParagraphRequest();
  const result = {
    selectionKind: "paragraph",
    sourceText: request.selection,
    translationZh: "First sentence.\nSecond sentence.",
    type: "translate-passage",
  };

  assert.equal(validateSmokeResult(request, result), result);
});

test("smoke validation rejects a result for a different request", () => {
  const request = {
    requestId: "smoke-word",
    selection: "investigation",
    selectionKind: "word",
  };
  assert.throws(
    () =>
      validateSmokeResult(request, {
        selectionKind: request.selectionKind,
        sourceText: "different source",
        type: "translate-lexical",
      }),
    /did not match request/i,
  );
});
