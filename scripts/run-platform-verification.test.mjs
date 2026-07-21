import assert from "node:assert/strict";
import test from "node:test";

import {
  platformVerificationSteps,
  runPlatformVerification,
} from "./run-platform-verification.mjs";

function labels(steps) {
  return steps.map((step) => [step.command, ...step.arguments].join(" "));
}

test("macOS verification runs the complete shared and browser gate in order", () => {
  assert.deepEqual(labels(platformVerificationSteps("darwin")), [
    "pnpm check:instructions",
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:e2e",
    "pnpm build",
    "git diff --check",
  ]);
});

test("Windows verification packages and probes the SEA after offline gates", () => {
  assert.deepEqual(labels(platformVerificationSteps("win32")), [
    "pnpm check:instructions",
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
    "pnpm host:windows:package",
    "node scripts/verify-windows-sea.mjs",
    "git diff --check",
  ]);
});

test("platform verification rejects the wrong operating system before running a command", async () => {
  const observed = [];

  await assert.rejects(
    runPlatformVerification({
      actualPlatform: "darwin",
      expectedPlatform: "win32",
      runStep: async (step) => observed.push(step),
    }),
    /requires Windows/i,
  );
  assert.deepEqual(observed, []);
});

test("platform verification stops at the first failed command", async () => {
  const observed = [];

  await assert.rejects(
    runPlatformVerification({
      actualPlatform: "darwin",
      expectedPlatform: "darwin",
      runStep: async (step) => {
        observed.push(labels([step])[0]);
        if (step.arguments[0] === "lint") throw new Error("lint failed");
      },
    }),
    /lint failed/,
  );
  assert.deepEqual(observed, ["pnpm check:instructions", "pnpm format:check", "pnpm lint"]);
});
