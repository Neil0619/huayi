import { expect, it } from "vitest";

import { createHealthApp } from "./app.js";

it("exposes the service health contract", async () => {
  const server = createHealthApp();
  const response = await server.request("/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ service: "huayi-cloud-api", status: "ok" });
});
