import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { build } from "vite";

let workerSource: string;

test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(new URL("../src/wordbook/eudic-client.ts", import.meta.url)),
        formats: ["iife"],
        name: "EudicClientFixture",
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!output || !("output" in output)) throw new Error("Expected one bundle.");
  const chunk = output.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing Eudic client bundle.");
  workerSource = `${chunk.code}
const client = new EudicClientFixture.StoreEudicClient({
  authorization: async () => 'Bearer offline-fixture',
});
(async () => {
  try {
    const words = await client.listWords(0, new AbortController().signal);
    const added = await client.addWord('apple', undefined, new AbortController().signal);
    postMessage({words, added});
  } catch (error) {
    postMessage({error: error.code});
  }
})();`;
});

test("Eudic discovery and export use native worker fetch with offline responses", async ({
  page,
}) => {
  const requests: string[] = [];
  const unexpected: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === "https://eudic-fixture.test") {
      await route.fulfill({
        contentType: url.pathname === "/client-worker.js" ? "text/javascript" : "text/html",
        body:
          url.pathname === "/client-worker.js"
            ? workerSource
            : "<!doctype html><title>Offline Eudic fixture</title>",
      });
      return;
    }
    if (url.origin !== "https://api.frdic.com") {
      unexpected.push(url.origin);
      await route.abort();
      return;
    }
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    requests.push(`${request.method()} ${url.pathname}`);
    const listing = url.pathname === "/api/open/v1/studylist/words";
    await route.fulfill({
      status: listing ? 200 : request.method() === "GET" ? 404 : 201,
      headers,
      contentType: "application/json",
      body: JSON.stringify(
        listing
          ? {
              data: [{ word: "apple", add_time: "2026-09-15T00:00:00.000Z", exp: "", star: 0 }],
              message: "ok",
            }
          : { message: "ok" },
      ),
    });
  });
  await page.goto("https://eudic-fixture.test");
  const result = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker("/client-worker.js");
        worker.onmessage = (event) => {
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = () => {
          worker.terminate();
          reject(new Error("Fixture worker failed."));
        };
      }),
  );
  expect(result).toEqual({
    words: [{ headword: "apple", addedAt: "2026-09-15T00:00:00.000Z" }],
    added: "created",
  });
  expect(requests).toEqual([
    "GET /api/open/v1/studylist/words",
    "GET /api/open/v1/studylist/word",
    "POST /api/open/v1/studylist/word",
  ]);
  expect(unexpected).toEqual([]);
});
