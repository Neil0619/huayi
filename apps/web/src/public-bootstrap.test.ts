import { describe, expect, it } from "vitest";

import { resolveWebBootstrap } from "./public-bootstrap.js";

describe("public Web bootstrap", () => {
  it("resolves exact privacy before requiring an API origin", () => {
    expect(resolveWebBootstrap("/privacy", {})).toEqual({ publicPage: "privacy" });
  });

  it("selects the public privacy channel without requiring authentication or API configuration", () => {
    for (const channel of ["production", "hosted-acceptance"]) {
      expect(resolveWebBootstrap("/privacy", { VITE_DEPLOYMENT_ENVIRONMENT: channel })).toEqual({
        publicPage: "privacy",
        publicDeploymentEnvironment: channel,
      });
    }
    expect(
      resolveWebBootstrap("/privacy", { VITE_DEPLOYMENT_ENVIRONMENT: "unrecognized" }),
    ).toEqual({ publicPage: "privacy" });
  });

  it("keeps unknown and near-match routes behind strict environment parsing", () => {
    expect(resolveWebBootstrap("/privacy/", {})).toEqual({});
    expect(resolveWebBootstrap("/app", {})).toEqual({});
    expect(resolveWebBootstrap("/app", { VITE_API_ORIGIN: "https://api.huayi.example" })).toEqual({
      environment: { VITE_API_ORIGIN: "https://api.huayi.example" },
    });
    expect(
      resolveWebBootstrap("/app", {
        VITE_ACCEPTANCE_MODEL: "simulated",
        VITE_API_ORIGIN: "https://api.acceptance.localhost:8444",
      }),
    ).toEqual({
      environment: {
        VITE_ACCEPTANCE_MODEL: "simulated",
        VITE_API_ORIGIN: "https://api.acceptance.localhost:8444",
      },
    });
    expect(
      resolveWebBootstrap("/app", {
        VITE_ACCEPTANCE_MODEL: "deepseek",
        VITE_API_ORIGIN: "https://api.acceptance.localhost:8444",
      }),
    ).toEqual({});
  });
});
