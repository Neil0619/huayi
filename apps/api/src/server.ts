import { createProductionAppFromProcess } from "./production-app.js";

export const app = createProductionAppFromProcess();
// eslint-disable-next-line no-restricted-syntax -- Vercel's Hono adapter requires a default app export.
export default app;
