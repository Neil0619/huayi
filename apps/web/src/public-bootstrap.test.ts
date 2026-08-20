import { describe, expect, it } from "vitest";

import { resolveWebBootstrap } from "./public-bootstrap.js";

describe("public Web bootstrap", () => {
  it("resolves exact privacy before requiring an API origin", () => {
    expect(resolveWebBootstrap("/privacy", {})).toEqual({ publicPage: "privacy" });
  });

  it("keeps unknown and near-match routes behind strict environment parsing", () => {
    expect(resolveWebBootstrap("/privacy/", {})).toEqual({});
    expect(resolveWebBootstrap("/app", {})).toEqual({});
    expect(resolveWebBootstrap("/app", { VITE_API_ORIGIN: "https://api.huayi.example" })).toEqual({
      environment: { VITE_API_ORIGIN: "https://api.huayi.example" },
    });
  });
});
