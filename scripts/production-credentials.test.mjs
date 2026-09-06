import assert from "node:assert/strict";
import test from "node:test";

import {
  productionCredentialService,
  readProductionCredential,
  runProductionCredentialsCli,
} from "./production-credentials.mjs";

const token = "sbp_fixture-production-management-token";
const password = "fictional-production-database-password";
const providerKeys = Object.freeze({
  "deepseek-api-key": "sk-fixture-production-deepseek-key",
  "resend-smtp-key": "re_fixture-production-smtp-key",
  "resend-notification-key": "re_fixture-production-notification-key",
});
const acceptanceService = "cn.seen-said.huayi.hosted.acceptance";

function fixture({ existing = {}, failure, allowRotate = false, ...options } = {}) {
  const items = new Map([
    [`${acceptanceService}/supabase-management-token`, "fictional-acceptance-token"],
    ...Object.entries(existing).map(([id, value]) => [
      `${productionCredentialService}/${id}`,
      value,
    ]),
  ]);
  const calls = [];
  const output = [];
  const runSecurity = async (request) => {
    calls.push(request);
    const args = request.arguments_;
    const id = args[args.indexOf("-a") + 1];
    const key = `${args[args.indexOf("-s") + 1]}/${id}`;
    if (failure?.(request, id)) return { code: 36, stderr: token, stdout: password };
    if (args[0] === "add-generic-password") {
      assert.equal(request.interactive, true);
      assert.equal(args.at(-1), "-w");
      assert.equal(args.includes("-U"), allowRotate, "only explicit rotation may replace an item");
      items.set(key, providerKeys[id] ?? (id === "supabase-management-token" ? token : password));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (!items.has(key)) return { code: 44, stdout: "", stderr: "" };
    return {
      code: 0,
      stdout: args.includes("-w") ? `${items.get(key)}\n` : "metadata",
      stderr: "",
    };
  };
  return {
    calls,
    items,
    output,
    runSecurity,
    cli: (arguments_) =>
      runProductionCredentialsCli({
        arguments_,
        environment: {},
        platform: "darwin",
        stdinIsTTY: true,
        stderrIsTTY: true,
        runSecurity,
        writeOutput: (value) => output.push(value),
        writeError: (value) => output.push(value),
        ...options,
      }),
  };
}

test("production setup stores independent credentials using protected input and preserves acceptance", async () => {
  const f = fixture();
  assert.equal(productionCredentialService, "cn.seen-said.huayi.production");
  assert.equal(await f.cli(["configure"]), 0);
  assert.equal(
    f.items.get(`${acceptanceService}/supabase-management-token`),
    "fictional-acceptance-token",
  );
  assert.equal(
    await readProductionCredential("supabase-management-token", {
      environment: {},
      platform: "darwin",
      runSecurity: f.runSecurity,
    }),
    token,
  );
  assert.equal(
    await readProductionCredential("supabase-admin-db-password", {
      environment: {},
      platform: "darwin",
      runSecurity: f.runSecurity,
    }),
    password,
  );
  assert.equal(JSON.stringify(f.calls).includes(token), false);
  assert.equal(JSON.stringify(f.calls).includes(password), false);
  assert.equal(f.output.join("").includes(token), false);
  assert.equal(f.output.join("").includes(password), false);
});

test("repeated configure validates and preserves existing production credentials", async () => {
  const existingToken = "sbp_fixture-previous-production-token";
  const f = fixture({ existing: { "supabase-management-token": existingToken } });
  assert.equal(await f.cli(["configure", "--", "--name", "supabase-management-token"]), 0);
  assert.equal(
    f.items.get(`${productionCredentialService}/supabase-management-token`),
    existingToken,
  );
  assert.equal(
    f.calls.some((call) => call.interactive),
    false,
  );
});

test("all credentials are preflighted before any write and raw failures stay private", async () => {
  const f = fixture({ failure: (_request, id) => id === "supabase-admin-db-password" });
  assert.equal(await f.cli(["configure"]), 1);
  assert.equal(
    f.calls.some((call) => call.interactive),
    false,
  );
  assert.equal(f.output.join("").includes(token), false);
  assert.equal(f.output.join("").includes(password), false);
});

test("missing terminal, unsupported platforms, plaintext environment and unknown arguments fail before access", async () => {
  for (const options of [
    { stdinIsTTY: false },
    { stderrIsTTY: false },
    { platform: "win32" },
    { environment: { SUPABASE_ACCESS_TOKEN: token } },
    { environment: { HUAYI_PRODUCTION_MANAGEMENT_TOKEN: token } },
  ]) {
    const f = fixture(options);
    assert.equal(await f.cli(["configure"]), 1);
    assert.equal(f.calls.length, 0);
    assert.equal(f.output.join("").includes(token), false);
  }
  for (const args of [["configure", token], ["configure", "--name", "vercel-token"], ["remove"]]) {
    const f = fixture();
    assert.equal(await f.cli(args), 1);
    assert.equal(f.calls.length, 0);
    assert.equal(f.output.join("").includes(token), false);
  }
});

test("malformed values fail validation without overwriting or exposing them", async () => {
  for (const value of ["short", `${token}\nprivate`, ` ${token}`, password]) {
    const f = fixture({ existing: { "supabase-management-token": value } });
    assert.equal(await f.cli(["configure", "--name", "supabase-management-token"]), 1);
    assert.equal(
      f.calls.some((call) => call.interactive),
      false,
    );
    assert.equal(f.output.join("").includes(value), false);
  }
});

test("explicit rotation repairs one invalid management credential without changing either database or acceptance credentials", async () => {
  const f = fixture({
    allowRotate: true,
    existing: {
      "supabase-management-token": password,
      "supabase-admin-db-password": password,
    },
  });
  assert.equal(await f.cli(["rotate", "--name", "supabase-management-token"]), 0);
  assert.equal(f.items.get(`${productionCredentialService}/supabase-management-token`), token);
  assert.equal(f.items.get(`${productionCredentialService}/supabase-admin-db-password`), password);
  assert.equal(
    f.items.get(`${acceptanceService}/supabase-management-token`),
    "fictional-acceptance-token",
  );
  assert.match(f.output.join(""), /supabase-management-token\|rotated/u);
});

test("rotation requires one named account and a real terminal", async () => {
  for (const [arguments_, options] of [
    [["rotate"], {}],
    [["rotate", "--name", "supabase-management-token"], { stdinIsTTY: false }],
  ]) {
    const f = fixture(options);
    assert.equal(await f.cli(arguments_), 1);
    assert.equal(f.calls.length, 0);
  }
});

test("status reports presence without reading secret values or modifying Keychain", async () => {
  const f = fixture({ existing: { "supabase-management-token": token } });
  assert.equal(await f.cli(["status"]), 1);
  assert.match(f.output.join(""), /supabase-management-token\|present/u);
  assert.match(f.output.join(""), /supabase-admin-db-password\|missing/u);
  assert.equal(
    f.calls.some((call) => call.arguments_.includes("-w") || call.interactive),
    false,
  );
});

test("default configure still asks for only the two initialization credentials", async () => {
  const f = fixture();
  assert.equal(await f.cli(["configure"]), 0);
  assert.deepEqual(
    f.calls
      .filter((call) => call.interactive)
      .map((call) => {
        const args = call.arguments_;
        return args[args.indexOf("-a") + 1];
      }),
    ["supabase-management-token", "supabase-admin-db-password"],
  );
});

for (const [id, value] of Object.entries(providerKeys)) {
  test(`named production ${id} input stays private and preserves initialization credentials`, async () => {
    const f = fixture({ existing: { "supabase-management-token": token } });
    assert.equal(await f.cli(["configure", "--name", id]), 0);
    assert.equal(f.items.get(`${productionCredentialService}/${id}`), value);
    assert.equal(f.items.get(`${productionCredentialService}/supabase-management-token`), token);
    assert.equal(
      await readProductionCredential(id, {
        environment: {},
        platform: "darwin",
        runSecurity: f.runSecurity,
      }),
      value,
    );
    assert.equal(JSON.stringify(f.calls).includes(value), false);
    assert.equal(f.output.join("").includes(value), false);
    assert.equal(await f.cli(["status", "--name", id]), 0);
    assert.match(f.output.join(""), new RegExp(`${id}\\|present`, "u"));
  });

  test(`production ${id} rejects a misplaced management token and whitespace`, async () => {
    for (const invalid of [token, `${value} `, `${value}\nprivate`, "short"]) {
      const f = fixture({ existing: { [id]: invalid } });
      assert.equal(await f.cli(["configure", "--name", id]), 1);
      assert.equal(
        f.calls.some((call) => call.interactive),
        false,
      );
      assert.equal(f.output.join("").includes(invalid), false);
    }
  });
}
