import { expect, test, type Route } from "@playwright/test";
import {
  contractFixtures,
  structuredTeachingAccept,
  type LearningTaskSnapshotRead,
} from "@huayi/cloud-contracts";
import { nativeWebAnalysis } from "../src/native-analysis.test-support.js";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { createPracticeProgressionAuthority } from "./support/practice-progression-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";
const headers = cloudCors("https://web.huayi.invalid") ?? {};
const json = (route: Route, value: unknown) => route.fulfill({ status: 200, headers, json: value });
const frame = (event: string, data: unknown, id?: number) =>
  `event: ${event}\n${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`;
for (const width of [390, 1440])
  test(`native stream recovery and API composition at ${width}`, async ({ page }, testInfo) => {
    const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
    await authority.install(page);
    const base = nativeWebAnalysis();
    const analysis = {
      ...base,
      sourceText: base.sourceText.trim(),
      studyCaptureId: "capture-native",
    };
    if (analysis.result.type !== "sentence-passage-analysis-v3" || !analysis.result.sentences[0])
      throw new Error("fixture");
    const first = analysis.result.sentences[0];
    const capture = {
      captureCount: 1,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
      firstCapturedAt: analysis.createdAt,
      lastCapturedAt: analysis.createdAt,
      id: "capture-native",
      kind: "passage",
      normalizedTextHash: "a".repeat(64),
      revision: 1,
      sourceText: analysis.sourceText,
      status: "analyzing",
    };
    const task: LearningTaskSnapshotRead = {
      version: 2,
      id: "native-task",
      kind: "capture-analysis",
      subjectId: capture.id,
      state: "running",
      cursor: 1,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
      error: null,
      timings: {},
      output: null,
    };
    const output = { ...contractFixtures.completedEvent, analysis };
    let release: () => void = () => undefined;
    let finished = false;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: { path: string; method: string; accept: string }[] = [];
    await page.route("https://api.huayi.invalid/v2/learning-tasks**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      requests.push({
        path: url.pathname + url.search,
        method: request.method(),
        accept: request.headers().accept ?? "",
      });
      if (url.pathname === "/v2/learning-tasks") return json(route, finished ? [] : [task]);
      if (!url.pathname.endsWith("/events")) throw new Error("Unexpected offline task write/read.");
      const cursor = url.searchParams.get("cursor");
      if (cursor === "0" && !finished)
        return route.fulfill({
          status: 200,
          headers: { ...headers, "Content-Type": "text/event-stream" },
          body:
            frame(
              "learning-task",
              {
                version: 2,
                taskId: task.id,
                cursor: 1,
                payload: {
                  type: "analysis.structure",
                  requestId: "native-request",
                  unit: {
                    analysisUnitId: first.analysisUnitId,
                    ordinal: first.ordinal,
                    sourceText: first.sourceText,
                    sentenceStructure: first.sentenceStructure,
                  },
                },
              },
              1,
            ) + frame("task-status", task),
        });
      await wait;
      finished = true;
      return route.fulfill({
        status: 200,
        headers: { ...headers, "Content-Type": "text/event-stream" },
        body: frame("task-status", { ...task, state: "completed", output }),
      });
    });
    await page.route("https://api.huayi.invalid/v1/study-captures**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      const detail = {
        capture: { ...capture, status: finished ? "analyzed" : "analyzing" },
        activeAnalysisRequest: null,
        latestAnalysis: finished
          ? {
              id: analysis.id,
              revision: 1,
              createdAt: analysis.createdAt,
              reviewState: "pendingReview",
            }
          : null,
      };
      return json(
        route,
        url.pathname.endsWith(capture.id)
          ? detail
          : {
              items:
                url.searchParams.get("status") === (finished ? "analyzed" : "analyzing")
                  ? [detail]
                  : [],
              nextCursor: null,
            },
      );
    });
    await page.route("https://api.huayi.invalid/v1/analyses**", (route) =>
      json(
        route,
        new URL(route.request().url()).pathname === "/v1/analyses"
          ? { items: finished ? [analysis] : [], nextCursor: null }
          : analysis,
      ),
    );
    await page.setViewportSize({ width, height: 920 });
    await page.goto("https://web.huayi.invalid/app");
    await expect(page.locator("[data-native-unit]")).toHaveCount(1);
    const summary = page.locator("[data-structure-modifiers] > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await summary.evaluate((node) => {
      node.setAttribute("data-preserved", "yes");
    });
    release();
    await expect(page.locator("[data-native-unit]")).toHaveCount(2);
    await expect(summary).toHaveAttribute("data-preserved", "yes");
    await expect(summary).toBeFocused();
    await expect(page.locator("[data-structure-modifiers]")).toHaveAttribute("open", "");
    expect(requests.some((request) => request.path.endsWith("/events?cursor=1"))).toBe(true);
    expect(
      requests
        .filter((request) => request.path.includes("/events"))
        .every((request) => request.accept === structuredTeachingAccept.eventStream),
    ).toBe(true);
    expect(
      requests
        .filter((request) => request.path === "/v2/learning-tasks")
        .every((request) => request.accept === structuredTeachingAccept.json),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`native-recovery-${width}.png`),
      fullPage: true,
    });
    await page.goto("https://web.huayi.invalid/history");
    await page.locator("[data-open-analysis]").first().click();
    await expect(page.locator("[data-native-unit]")).toHaveCount(2);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

test("the composed Web API keeps practice tasks on the existing reader", async ({ page }) => {
  const authority = createPracticeProgressionAuthority();
  await authority.install(page);
  const requests: { method: string; path: string; accept: string }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/v2/learning-tasks") && request.method() !== "OPTIONS")
      requests.push({
        method: request.method(),
        path: url.pathname,
        accept: request.headers().accept ?? "",
      });
  });
  await page.goto("https://web.huayi.invalid/practice");
  await page.getByRole("button", { name: "开始今日练习", exact: true }).click();
  await page
    .getByRole("textbox", { name: "你的英文句子" })
    .fill("At least we can finish tomorrow.");
  await page.getByRole("button", { name: "提交并获取反馈" }).click();
  await expect(page.getByRole("heading", { name: "练习反馈", exact: true })).toBeVisible();
  expect(requests.some((request) => request.method === "POST")).toBe(true);
  expect(
    requests.some(
      (request) => request.path.endsWith("/events") && request.accept === "text/event-stream",
    ),
  ).toBe(true);
  expect(
    requests.every(
      (request) =>
        request.accept !== structuredTeachingAccept.json &&
        request.accept !== structuredTeachingAccept.eventStream,
    ),
  ).toBe(true);
});
