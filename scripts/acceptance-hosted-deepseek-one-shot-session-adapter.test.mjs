import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptHostedDeepSeekNormalWebLogout,
  createHostedDeepSeekNormalWebSessionAdapter,
} from "./acceptance-hosted-deepseek-one-shot-session.mjs";

const failurePattern = /^Error: Hosted Cloud Web DeepSeek one-shot failed closed\.$/u;
const oldMaterial = Object.freeze({
  cookie: `huayi_session=${"o".repeat(32)}`,
  csrfToken: "c".repeat(32),
});
const replacementMaterial = Object.freeze({
  cookie: `huayi_session=${"n".repeat(32)}`,
  csrfToken: "r".repeat(32),
});
const operatorAuthorization = Object.freeze({
  access: "full",
  observedAt: "2026-08-26T02:10:00.000Z",
  operator: true,
  reauthenticatedAt: "2026-08-26T02:00:01.000Z",
});

function transport(overrides = {}) {
  return {
    invokeCloudWebAnalysis: async () => ({
      requestId: "30000000-0000-4000-8000-000000000003",
    }),
    loginPassword: async () => oldMaterial,
    logout: async () => undefined,
    readOperatorAuthorization: async () => operatorAuthorization,
    reauthenticatePassword: async () => replacementMaterial,
    reconcileDispatchedRequest: async () => ({ complete: true, matches: [] }),
    setModelKillSwitch: async () => undefined,
    ...overrides,
  };
}

test("private session adapter invalidates login Cookie and CSRF after rotation", async () => {
  const materialCalls = [];
  const session = createHostedDeepSeekNormalWebSessionAdapter({
    transport: transport({
      invokeCloudWebAnalysis: async (material) => {
        materialCalls.push(["analysis", material]);
        return { requestId: "30000000-0000-4000-8000-000000000003" };
      },
      logout: async (material) => materialCalls.push(["logout", material]),
      readOperatorAuthorization: async (material) => {
        materialCalls.push(["operator", material]);
        return operatorAuthorization;
      },
      reauthenticatePassword: async (material) => {
        materialCalls.push(["reauthenticate", material]);
        return replacementMaterial;
      },
      reconcileDispatchedRequest: async (material) => {
        materialCalls.push(["reconcile", material]);
        return { complete: true, matches: [] };
      },
      setModelKillSwitch: async (material) => materialCalls.push(["kill-switch", material]),
    }),
  });

  await session.loginPassword({});
  await session.reauthenticatePassword({});
  await session.readOperatorAuthorization({});
  await session.setModelKillSwitch(false, {});
  await session.invokeCloudWebAnalysis({}, {});
  await session.reconcileDispatchedRequest({}, {});
  await session.logout({});

  assert.deepEqual(materialCalls[0], ["reauthenticate", oldMaterial]);
  for (const [stage, material] of materialCalls.slice(1)) {
    assert.equal(material.cookie, replacementMaterial.cookie, stage);
    assert.equal(material.csrfToken, replacementMaterial.csrfToken, stage);
    assert.notEqual(material.cookie, oldMaterial.cookie, stage);
    assert.notEqual(material.csrfToken, oldMaterial.csrfToken, stage);
  }
  assert.deepEqual(Object.keys(session).sort(), [
    "destroySession",
    "invokeCloudWebAnalysis",
    "loginPassword",
    "logout",
    "readOperatorAuthorization",
    "reauthenticatePassword",
    "reconcileDispatchedRequest",
    "setModelKillSwitch",
  ]);
  assert.equal(JSON.stringify(session).includes(oldMaterial.cookie), false);
  assert.equal(JSON.stringify(session).includes(replacementMaterial.csrfToken), false);
  await assert.rejects(session.logout({}), failurePattern);
});

test("non-rotating CSRF fails closed but logout adopts the replacement Cookie", async () => {
  const partialReplacement = Object.freeze({
    cookie: replacementMaterial.cookie,
    csrfToken: oldMaterial.csrfToken,
  });
  let logoutMaterial;
  const session = createHostedDeepSeekNormalWebSessionAdapter({
    transport: transport({
      logout: async (material) => {
        logoutMaterial = material;
      },
      reauthenticatePassword: async () => partialReplacement,
    }),
  });

  await session.loginPassword({});
  await assert.rejects(session.reauthenticatePassword({}), failurePattern);
  await session.logout({});
  assert.deepEqual(logoutMaterial, partialReplacement);
});

test("partial reauth retains its replacement Cookie for one normal logout attempt", async () => {
  let logoutMaterial;
  const session = createHostedDeepSeekNormalWebSessionAdapter({
    transport: transport({
      logout: async (material) => {
        logoutMaterial = material;
      },
      reauthenticatePassword: async () => ({
        cookie: replacementMaterial.cookie,
        csrfToken: "bad",
      }),
    }),
  });

  await session.loginPassword({});
  await assert.rejects(session.reauthenticatePassword({}), failurePattern);
  await session.logout({});
  assert.equal(logoutMaterial.cookie, replacementMaterial.cookie);
  assert.equal(logoutMaterial.csrfToken, undefined);
});

test("partial login retains a usable Cookie for one normal logout attempt", async () => {
  let logoutMaterial;
  const session = createHostedDeepSeekNormalWebSessionAdapter({
    transport: transport({
      loginPassword: async () => ({ cookie: oldMaterial.cookie, csrfToken: "bad" }),
      logout: async (material) => {
        logoutMaterial = material;
      },
    }),
  });

  await assert.rejects(session.loginPassword({}), failurePattern);
  await session.logout({});
  assert.equal(logoutMaterial.cookie, oldMaterial.cookie);
  assert.equal(logoutMaterial.csrfToken, undefined);
});

test("a rejected login transport is failure-atomic and creates no logout material", async () => {
  let logoutCalls = 0;
  const session = createHostedDeepSeekNormalWebSessionAdapter({
    transport: transport({
      loginPassword: async () => {
        throw new Error("private failure before a server session exists");
      },
      logout: async () => {
        logoutCalls += 1;
      },
    }),
  });

  await assert.rejects(session.loginPassword({}), failurePattern);
  await assert.rejects(session.logout({}), failurePattern);
  assert.equal(logoutCalls, 0);
});

test("ignored logout is synchronously destroyed after its independent deadline", async () => {
  let fireLogoutDeadline;
  const session = createHostedDeepSeekNormalWebSessionAdapter({
    transport: transport({
      logout: async () => {
        queueMicrotask(fireLogoutDeadline);
        return new Promise(() => undefined);
      },
    }),
  });
  await session.loginPassword({});
  await session.reauthenticatePassword({});

  assert.equal(
    await attemptHostedDeepSeekNormalWebLogout({
      adapter: session,
      budgetMilliseconds: 10_000,
      clearTimeout_: () => undefined,
      readNowMilliseconds: () => 1_000,
      setTimeout_: (callback) => {
        fireLogoutDeadline = callback;
        return 1;
      },
    }),
    false,
  );
  await assert.rejects(session.setModelKillSwitch(true, {}), failurePattern);
  await assert.rejects(session.logout({}), failurePattern);
});

for (const failureCase of ["invalid clock", "timer construction"]) {
  test(`${failureCase} logout failure still synchronously destroys session capability`, async () => {
    const session = createHostedDeepSeekNormalWebSessionAdapter({ transport: transport() });
    await session.loginPassword({});
    await session.reauthenticatePassword({});

    assert.equal(
      await attemptHostedDeepSeekNormalWebLogout({
        adapter: session,
        budgetMilliseconds: 10_000,
        clearTimeout_: () => undefined,
        readNowMilliseconds: () => (failureCase === "invalid clock" ? Number.NaN : 1_000),
        setTimeout_: () => {
          if (failureCase === "timer construction") throw new Error("private timer failure");
          return 1;
        },
      }),
      false,
    );
    await assert.rejects(session.setModelKillSwitch(true, {}), failurePattern);
    await assert.rejects(session.logout({}), failurePattern);
  });
}
