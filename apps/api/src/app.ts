import { Hono, type Hono as HonoApp } from "hono";

export function createHealthApp(): HonoApp {
  const app = new Hono();
  app.get("/health", (context) => context.json({ service: "huayi-cloud-api", status: "ok" }));
  return app;
}

export const app = createHealthApp();
