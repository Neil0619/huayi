import { describe, expect, it } from "vitest";

import { parseApiEnvironment } from "./environment.js";
import { createProductionDeepSeekPricing } from "./production-deepseek-pricing.js";

// Load the actual release script without adding API runtime dependencies or script declarations.
const { buildProductionEnvironment } = (await import(
  new URL("../../../scripts/production-release-environment.mjs", import.meta.url).href
)) as {
  buildProductionEnvironment(secrets: Record<string, string>): {
    api: Record<string, string>;
    web: Record<string, string>;
  };
};

const secrets = {
  databasePassword: "d".repeat(64),
  databaseCa: "-----BEGIN CERTIFICATE-----\n" + "a".repeat(256) + "\n-----END CERTIFICATE-----\n",
  deepseekApiKey: "sk-" + "d".repeat(40),
  refreshEncryptionKey: Buffer.alloc(32, 1).toString("base64url"),
  secretPepper: "p".repeat(43),
  cronSecret: "c".repeat(43),
  supabasePublishableKey: "sb_publishable_" + "p".repeat(30),
  supabaseServiceRoleKey: "s".repeat(100),
  resendNotificationKey: "re_" + "r".repeat(40),
};
const deploymentIdentity = {
  VERCEL_DEPLOYMENT_ID: "dpl_syntheticProductionConfiguration",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
};
const priceKeys = [
  "HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID",
  "HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID",
  "HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID",
  "HUAYI_DEEPSEEK_20260910_OFF_PEAK_PRICE_VERSION_ID",
  "HUAYI_DEEPSEEK_20260910_PEAK_PRICE_VERSION_ID",
] as const;

describe("production release configuration contract", () => {
  it("parses the generated API environment with complete deployment identity", () => {
    const environment = { ...buildProductionEnvironment(secrets).api, ...deploymentIdentity };

    expect(parseApiEnvironment(environment)).toEqual(environment);
    expect(parseApiEnvironment(environment).HUAYI_STORE_EXTENSION_ID).toBe(
      "kehpghgppccjlmahanlmeagnpnfbcnea",
    );
  });

  it.each(priceKeys)("requires a valid, unique %s without exposing credentials", (key) => {
    const environment: Record<string, string> = {
      ...buildProductionEnvironment(secrets).api,
      ...deploymentIdentity,
    };
    const otherKey = key === priceKeys[0] ? priceKeys[1] : priceKeys[0];
    for (const invalid of [undefined, secrets.deepseekApiKey, environment[otherKey]]) {
      let error: unknown;
      try {
        parseApiEnvironment({ ...environment, [key]: invalid });
      } catch (cause) {
        error = cause;
      }
      expect(error).toBeInstanceOf(Error);
      for (const secret of Object.values(secrets)) {
        expect(String(error)).not.toContain(secret);
      }
    }
  });

  it("preserves the deployment identity requirement", () => {
    const { api } = buildProductionEnvironment(secrets);
    expect(() => parseApiEnvironment(api)).toThrow();
    for (const key of Object.keys(deploymentIdentity)) {
      expect(() =>
        parseApiEnvironment({ ...api, ...deploymentIdentity, [key]: undefined }),
      ).toThrow();
    }
  });

  it("feeds all five immutable price snapshots into the production pricing consumer", () => {
    const environment = parseApiEnvironment({
      ...buildProductionEnvironment(secrets).api,
      ...deploymentIdentity,
    });
    const pricing = createProductionDeepSeekPricing(environment);
    const prices = [
      [2_800, 140_000, 280_000],
      [7_000, 220_000, 660_000],
      [14_000, 440_000, 1_320_000],
      [2_982, 149_081, 596_323],
      [5_964, 298_162, 1_192_646],
    ];
    expect(
      priceKeys.map((key) => {
        const snapshot = pricing.byId(environment[key]);
        expect(snapshot.priceVersionId).toBe(environment[key]);
        return [
          snapshot.prices.cachedInputMicroUsdPerMillionTokens,
          snapshot.prices.inputMicroUsdPerMillionTokens,
          snapshot.prices.outputMicroUsdPerMillionTokens,
        ];
      }),
    ).toEqual(prices);
    expect(pricing.reservation.priceVersionId).toBe(
      environment.HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID,
    );
    expect(pricing.at(new Date("2026-09-10T04:00:00Z")).priceVersionId).toBe(
      environment.HUAYI_DEEPSEEK_20260910_OFF_PEAK_PRICE_VERSION_ID,
    );
    expect(pricing.at(new Date("2026-09-10T06:00:00Z")).priceVersionId).toBe(
      environment.HUAYI_DEEPSEEK_20260910_PEAK_PRICE_VERSION_ID,
    );
  });
});
