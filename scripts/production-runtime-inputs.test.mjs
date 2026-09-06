import assert from "node:assert/strict";
import test from "node:test";

import { loadProductionRuntimeEnvironment } from "./production-runtime-inputs.mjs";

function fixture({ wrongRef = false, wrongRole = false, missingMail = false } = {}) {
  const ref = "pxqqgxfumovegbcxnmzb";
  const calls = [];
  return {
    calls,
    options: {
      readCredential: async (name) => {
        calls.push(name);
        if (name === "resend-notification-key" && missingMail) throw new Error("private");
        return (
          (name === "deepseek-api-key"
            ? "sk-"
            : name === "resend-notification-key"
              ? "re_"
              : "sbp_") + "a".repeat(40)
        );
      },
      readRuntimeSecrets: async (...args) => {
        assert.deepEqual(args, []);
        return {
          databasePassword: "d".repeat(64),
          refreshEncryptionKey: Buffer.alloc(32, 1).toString("base64url"),
          secretPepper: "p".repeat(43),
          cronSecret: "c".repeat(43),
        };
      },
      readCertificate: async () =>
        "-----BEGIN CERTIFICATE-----\n" + "a".repeat(256) + "\n-----END CERTIFICATE-----\n",
      fetch_: async (url, init) => {
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        assert.ok(url.startsWith(`https://api.supabase.com/v1/projects/${ref}`));
        calls.push(new URL(url).pathname);
        const value = url.endsWith("reveal=true")
          ? [
              { name: "default", type: "publishable", api_key: "sb_publishable_" + "k".repeat(40) },
              {
                name: "service_role",
                id: "service_role",
                type: "legacy",
                api_key:
                  "eyJhbGciOiJIUzI1NiJ9." +
                  Buffer.from(
                    JSON.stringify({ ref, role: wrongRole ? "anon" : "service_role" }),
                  ).toString("base64url") +
                  ".synthetic",
              },
            ]
          : {
              id: wrongRef ? "kpadiulxkgckskcfydry" : ref,
              organization_id: "ipkurvkfzrhqdxtfeuzz",
              region: "ap-southeast-1",
              status: "ACTIVE_HEALTHY",
            };
        return new Response(JSON.stringify(value));
      },
    },
  };
}

test("loads only production secrets after exact project and service role verification", async () => {
  const { options, calls } = fixture();
  const result = await loadProductionRuntimeEnvironment(options);
  assert.equal(result.api.HUAYI_DEPLOYMENT_ENVIRONMENT, "production");
  assert.equal(result.api.HUAYI_RESEND_API_KEY, "re_" + "a".repeat(40));
  assert.equal(calls.includes("supabase-admin-db-password"), false);
  assert.equal(calls.includes("resend-smtp-key"), false);
});

test("wrong project, mistaken service role and missing mail credentials fail without leaking values", async () => {
  for (const scenario of [{ wrongRef: true }, { wrongRole: true }, { missingMail: true }]) {
    const { options } = fixture(scenario);
    await assert.rejects(loadProductionRuntimeEnvironment(options), {
      message: "Production runtime credentials or project identity are unavailable.",
    });
  }
});
