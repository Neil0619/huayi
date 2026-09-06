import { expect, it } from "vitest";

import { createHealthApp, hostedDeploymentIdentityFromEnvironment } from "./health-app.js";

const deployment = {
  VERCEL_DEPLOYMENT_ID: "dpl_production123",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
};

it("attests the explicit production channel through the real environment adapter", async () => {
  const identity = hostedDeploymentIdentityFromEnvironment({
    ...deployment,
    HUAYI_DEPLOYMENT_ENVIRONMENT: "production",
  });
  const response = await createHealthApp(identity).request("/health");
  expect(response.headers.get("x-huayi-release-channel")).toBe("production");
  expect(response.headers.get("x-huayi-deployment-commit")).toBe(deployment.VERCEL_GIT_COMMIT_SHA);
  expect(response.headers.get("x-huayi-deployment-id")).toBe(deployment.VERCEL_DEPLOYMENT_ID);
  await expect(response.json()).resolves.toEqual({ service: "huayi-cloud-api", status: "ok" });
});

it("preserves the existing acceptance deployment channel", async () => {
  const identity = hostedDeploymentIdentityFromEnvironment(deployment);
  const response = await createHealthApp(identity).request("/health");
  expect(response.headers.get("x-huayi-release-channel")).toBe("hosted-acceptance");
});

it("cannot silently omit the identity of an explicit production deployment", () => {
  expect(() =>
    hostedDeploymentIdentityFromEnvironment({ HUAYI_DEPLOYMENT_ENVIRONMENT: "production" }),
  ).toThrow();
});
