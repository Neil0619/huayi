import { fileURLToPath } from "node:url";
import { build } from "vite";

// Keep the normal Vite configuration, while ignoring ambient .env files for this offline build.
await build({ root: fileURLToPath(new URL("../apps/web/", import.meta.url)), envDir: false });
