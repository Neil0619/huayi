import { Hono } from "hono";

import { readApiEnvironment } from "./environment.js";
import { createProductionApp } from "./production-app.js";

export const app = createProductionApp(readApiEnvironment(process.env));
if (!(app instanceof Hono)) {
  throw new TypeError("Invalid production application.");
}
// eslint-disable-next-line no-restricted-syntax -- Vercel's Hono adapter requires a default app export.
export default app;
