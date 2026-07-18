import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const entrypoint = new URL("./verify-ephemeral-session.mjs", import.meta.url);

function createLoaderSource() {
  const moduleSources = {
    "mock:child-process": "export function spawn() { return {}; }",
    "mock:fs-promises": `
      export async function access() {}
      export async function mkdtemp(prefix) { return prefix + "fake"; }
      export async function readdir() {
        const error = new Error("missing fixture directory");
        error.code = "ENOENT";
        throw error;
      }
      export async function realpath(path) { return path; }
      export async function rm() {}
    `,
    "mock:native-client": `
      export const HEALTH_TIMEOUT_MS = 1;
      export class NativeHostClient {
        get shutdownComplete() { return true; }
        async close() {}
        async request(request, expectedType, _timeoutMs, options) {
          if (request.type === "analyze") {
            const completedAt = Date.now();
            options?.validateTerminal?.({
              requestId: request.requestId,
              result: { contextualMeaningZh: "secret model output" },
              type: "result",
            });
            return {
              firstUpdateAt: completedAt,
              fullResultAt: completedAt,
              requestId: request.requestId,
              type: "result",
              updateCount: 1,
            };
          }
          return { requestId: request.requestId, type: expectedType };
        }
      }
      export class NativeMessageDecoder {}
      export function createNativeHostSpawnOptions() { return { detached: false }; }
      export function encodeNativeMessage() {}
      export function resolveCodexHome() { return "/mock/codex-home"; }
      export function validateSmokeResult() {}
    `,
    "mock:protocol": `
      const identitySchema = { parse: (value) => value };
      export const SCHEMA_VERSION = 5;
      export const analysisResultSchema = identitySchema;
      export const analyzeRequestSchema = identitySchema;
      export const healthRequestSchema = identitySchema;
      export const hostEventSchema = identitySchema;
      export const warmupRequestSchema = identitySchema;
    `,
    "mock:requests": `
      export function createSmokeRequests(schemaVersion) {
        return [{
          action: "translate",
          context: "secret source context",
          requestId: "smoke-fixture",
          schemaVersion,
          selection: "secret source",
          selectionKind: "word",
          sentenceContext: "secret source context",
          targetLanguage: "zh-CN",
          type: "analyze",
        }];
      }
    `,
  };
  return `
    const moduleSources = new Map(${JSON.stringify(Object.entries(moduleSources))});
    const overrides = new Map([
      ["node:child_process", "mock:child-process"],
      ["node:fs/promises", "mock:fs-promises"],
      ["./native-host-smoke-client.mjs", "mock:native-client"],
      ["./native-host-smoke-requests.mjs", "mock:requests"],
    ]);

    export async function resolve(specifier, context, nextResolve) {
      const override = overrides.get(specifier);
      if (override !== undefined) {
        return { shortCircuit: true, url: override };
      }
      if (specifier.endsWith("/packages/protocol/dist/index.js")) {
        return { shortCircuit: true, url: "mock:protocol" };
      }
      return nextResolve(specifier, context);
    }

    export async function load(url, context, nextLoad) {
      const source = moduleSources.get(url);
      if (source !== undefined) {
        return { format: "module", shortCircuit: true, source };
      }
      return nextLoad(url, context);
    }
  `;
}

test("direct smoke entrypoint writes only the three timing lines", async () => {
  const directory = await mkdtemp(join(tmpdir(), "huayi-smoke-entrypoint-test-"));
  const loader = join(directory, "loader.mjs");
  await writeFile(loader, createLoaderSource(), "utf8");

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-loader",
        pathToFileURL(loader).href,
        fileURLToPath(entrypoint),
      ],
      {
        env: {
          ...process.env,
          CODEX_HOME: "/mock/codex-home",
          HUAYI_CODEX_PATH: "/mock/codex",
        },
      },
    );

    assert.match(
      stdout,
      /^cold warmup: \d+ ms\nclick-to-first-delta: \d+ ms\nclick-to-full-result: \d+ ms\n$/u,
    );
    assert.doesNotMatch(stdout, /Smoke passed|secret model output|secret source/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
