import assert from "node:assert/strict";
import test from "node:test";
import { loadProductionRuntimeSecrets } from "./production-runtime-credentials.mjs";

function fixture() {
  let stored;
  let generated = 0;
  const writes = [];
  const reads = [];
  return {
    reads,
    writes,
    get generated() {
      return generated;
    },
    set stored(value) {
      stored = value;
    },
    options: {
      platform: "darwin",
      environment: {},
      randomBytes_: (size) => Buffer.alloc(size, ++generated),
      runSecurity: async (request) => {
        reads.push(request);
        return stored === undefined ? { code: 44 } : { code: 0, stdout: stored + "\n" };
      },
      runSecurityPrompt: async (request) => {
        writes.push(request);
        stored = request.value;
        return { code: 0 };
      },
    },
  };
}

test("production runtime reads never invent missing keys", async () => {
  const f = fixture();
  await assert.rejects(
    loadProductionRuntimeSecrets(f.options),
    /Production runtime credential unavailable/u,
  );
  assert.equal(f.generated, 0);
  assert.equal(f.writes.length, 0);
});

test("authorized creation generates four independent secrets in the production Keychain only", async () => {
  const f = fixture();
  const first = await loadProductionRuntimeSecrets({ ...f.options, createIfMissing: true });
  assert.equal(Buffer.from(first.databasePassword, "base64url").length, 48);
  assert.equal(Buffer.from(first.refreshEncryptionKey, "base64url").length, 32);
  assert.equal(new Set(Object.values(first)).size, 4);
  assert.equal(f.generated, 4);
  assert.equal(f.writes.length, 1);
  const w = f.writes[0];
  assert.equal(w.arguments_.includes("cn.seen-said.huayi.production"), true);
  assert.equal(w.arguments_.includes("-U"), false);
  assert.equal(w.arguments_.at(-1), "-w");
  for (const secret of Object.values(first)) {
    assert.equal(JSON.stringify([w.arguments_, w.environment]).includes(secret), false);
  }
  const second = await loadProductionRuntimeSecrets({ ...f.options, createIfMissing: true });
  assert.deepEqual(second, first);
  assert.equal(f.generated, 4);
  assert.equal(f.writes.length, 1);
  assert.ok(f.reads.every((r) => r.arguments_.includes("cn.seen-said.huayi.production")));
});

test("corrupt, locked, non-macOS and inherited plaintext environments fail without writes", async () => {
  for (const bad of ["{}", "private-failure", JSON.stringify({ databasePassword: "bad" })]) {
    const f = fixture();
    f.stored = bad;
    await assert.rejects(
      loadProductionRuntimeSecrets({ ...f.options, createIfMissing: true }),
      /Production runtime credential unavailable/u,
    );
    assert.equal(f.writes.length, 0);
  }
  for (const override of [
    { platform: "win32" },
    { environment: { PGPASSWORD: "private-value" } },
    {
      runSecurity: async () => {
        throw Error("private-value");
      },
    },
    { runSecurity: async () => ({ code: 36, stderr: "private-value" }) },
  ]) {
    const f = fixture();
    await assert.rejects(
      loadProductionRuntimeSecrets({ ...f.options, ...override, createIfMissing: true }),
      (e) => e.message === "Production runtime credential unavailable.",
    );
    assert.equal(f.writes.length, 0);
  }
});

test("uncertain or mismatched writes never report successful creation or overwrite a key", async () => {
  for (const code of [null, 1]) {
    const f = fixture();
    await assert.rejects(
      loadProductionRuntimeSecrets({
        ...f.options,
        createIfMissing: true,
        runSecurityPrompt: async () => ({ code }),
      }),
    );
  }
  const f = fixture();
  await assert.rejects(
    loadProductionRuntimeSecrets({
      ...f.options,
      createIfMissing: true,
      runSecurityPrompt: async () => {
        f.stored = "{}";
        return { code: 0 };
      },
    }),
  );
});
