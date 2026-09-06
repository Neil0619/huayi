import { expect, it } from "vitest";

import { parseWebEnvironment } from "./environment.js";

it("binds production to its own API and a validated commit", () => {
  const environment = {
    VITE_API_ORIGIN: "https://api.seen-said.cn",
    VITE_DEPLOYMENT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    VITE_DEPLOYMENT_ENVIRONMENT: "production",
  };
  expect(parseWebEnvironment(environment)).toEqual(environment);
  for (const override of [
    { VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn" },
    { VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance" },
    { VITE_DEPLOYMENT_ENVIRONMENT: undefined },
    { VITE_DEPLOYMENT_COMMIT: undefined },
    { VITE_DEPLOYMENT_COMMIT: "0123456" },
    { VITE_ACCEPTANCE_MODEL: "simulated" },
  ]) {
    expect(() => parseWebEnvironment({ ...environment, ...override })).toThrow();
  }
  expect(() => parseWebEnvironment({ VITE_API_ORIGIN: environment.VITE_API_ORIGIN })).toThrow();
});

it("accepts the API origin without contacting it", () => {
  expect(parseWebEnvironment({ VITE_API_ORIGIN: "https://api.huayi.example" })).toEqual({
    VITE_API_ORIGIN: "https://api.huayi.example",
  });
});

it("rejects non-exact HTTPS API origins before bootstrap", () => {
  for (const VITE_API_ORIGIN of [
    "http://api.huayi.example",
    "https://operator:secret@api.huayi.example",
    "https://api.huayi.example/v1",
    "https://api.huayi.example?environment=acceptance",
    "https://api.huayi.example#acceptance",
    "https://api.huayi.example/",
  ]) {
    expect(() => parseWebEnvironment({ VITE_API_ORIGIN })).toThrow();
  }
});

it("accepts only the explicit local acceptance simulated model mode", () => {
  expect(
    parseWebEnvironment({
      VITE_ACCEPTANCE_MODEL: "simulated",
      VITE_API_ORIGIN: "https://api.acceptance.localhost:8444",
    }),
  ).toEqual({
    VITE_ACCEPTANCE_MODEL: "simulated",
    VITE_API_ORIGIN: "https://api.acceptance.localhost:8444",
  });
  expect(() =>
    parseWebEnvironment({
      VITE_ACCEPTANCE_MODEL: "deepseek",
      VITE_API_ORIGIN: "https://api.acceptance.localhost:8444",
    }),
  ).toThrow();
  expect(() =>
    parseWebEnvironment({
      VITE_ACCEPTANCE_MODEL: "simulated",
      VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
    }),
  ).toThrow();
});

it("accepts hosted acceptance only with its exact API origin and full commit", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  expect(
    parseWebEnvironment({
      VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
      VITE_DEPLOYMENT_COMMIT: commit,
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
    }),
  ).toEqual({
    VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
    VITE_DEPLOYMENT_COMMIT: commit,
    VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
  });
  for (const environment of [
    {
      VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
    },
    {
      VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
      VITE_DEPLOYMENT_COMMIT: "0123456",
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
    },
    {
      VITE_API_ORIGIN: "https://api.huayi.example",
      VITE_DEPLOYMENT_COMMIT: commit,
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
    },
    {
      VITE_ACCEPTANCE_MODEL: "simulated",
      VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
      VITE_DEPLOYMENT_COMMIT: commit,
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
    },
    {
      VITE_API_ORIGIN: "https://api.acceptance.seen-said.cn",
      VITE_DEPLOYMENT_COMMIT: commit,
      VITE_DEPLOYMENT_ENVIRONMENT: "hosted-acceptance",
      VITE_GOOGLE_AUTHENTICATION: "enabled",
    },
  ]) {
    expect(() => parseWebEnvironment(environment)).toThrow();
  }
});

it("keeps Google authentication fail-closed unless explicitly enabled", () => {
  expect(parseWebEnvironment({ VITE_API_ORIGIN: "https://api.huayi.example" })).not.toHaveProperty(
    "VITE_GOOGLE_AUTHENTICATION",
  );
  expect(
    parseWebEnvironment({
      VITE_API_ORIGIN: "https://api.huayi.example",
      VITE_GOOGLE_AUTHENTICATION: "enabled",
    }),
  ).toEqual({
    VITE_API_ORIGIN: "https://api.huayi.example",
    VITE_GOOGLE_AUTHENTICATION: "enabled",
  });
  expect(() =>
    parseWebEnvironment({
      VITE_API_ORIGIN: "https://api.huayi.example",
      VITE_GOOGLE_AUTHENTICATION: "disabled",
    }),
  ).toThrow();
});
