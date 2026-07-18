import { startConfiguredNativeHost } from "./main.js";

try {
  startConfiguredNativeHost();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error.";
  process.stderr.write(`Native host startup error: ${message}\n`);
  process.exitCode = 1;
}
