import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

import { expectAnalyzeRequest, toolbar } from "./support/journey-helpers.js";

const youtubeFixture = fileURLToPath(
  new URL("./fixtures/youtube-caption-journeys.html", import.meta.url),
);
const builtContentScript = fileURLToPath(new URL("../dist/content-script.js", import.meta.url));
const builtYouTubeBridge = fileURLToPath(new URL("../dist/youtube-bridge.js", import.meta.url));
const youtubeWatchUrl = "https://www.youtube.com/watch?v=video-1";
const isolatedWorldName = "huayi-extension-content-script";
const isolatedWorlds = new WeakMap<Page, IsolatedWorldHarness>();

interface IsolatedWorldHarness {
  executionContextId: number;
  session: CDPSession;
}

interface IsolatedWorldProof {
  contentScriptExecuted: boolean;
  playerPrivateApiVisible: boolean;
  sentinel: string;
}

const isolatedRuntimeBootstrap = String.raw`
(() => {
  const runtimeListeners = new Set();
  const video = document.querySelector("[data-testid='youtube-video']");
  if (!(video instanceof HTMLVideoElement)) {
    throw new Error("Fixture video is unavailable.");
  }
  let currentTime = 4.5;
  let paused = false;
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value) => {
        currentTime = Number(value);
      },
    },
    duration: { configurable: true, get: () => 120 },
    ended: { configurable: true, get: () => false },
    paused: { configurable: true, get: () => paused },
  });
  video.pause = () => {
    paused = true;
    video.dataset.pauseCount = String(Number(video.dataset.pauseCount ?? "0") + 1);
    video.dispatchEvent(new Event("pause"));
  };
  video.play = () => {
    paused = false;
    video.dataset.playCount = String(Number(video.dataset.playCount ?? "0") + 1);
    video.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };
  const appendCommand = (command) => {
    const requestLog = document.querySelector("[data-native-request-log]");
    if (!(requestLog instanceof HTMLOListElement)) {
      throw new Error("Native request log is unavailable.");
    }
    const entry = document.createElement("li");
    entry.dataset.nativeCommand = command.type;
    if (command.request !== undefined) {
      entry.dataset.nativeRequest = command.request.type;
      entry.dataset.analysisAction = command.request.action ?? "";
      entry.dataset.analysisContext = command.request.context ?? "";
      entry.dataset.selectionKind = command.request.selectionKind ?? "";
      entry.dataset.selectionText = command.request.selection ?? "";
      entry.dataset.sentenceContext = command.request.sentenceContext ?? "";
    }
    requestLog.append(entry);
  };
  const chromeApi = globalThis.chrome ?? {};
  Object.defineProperty(chromeApi, "runtime", {
    configurable: true,
    value: {
      id: "huayi-e2e",
      onMessage: {
        addListener: (listener) => runtimeListeners.add(listener),
        removeListener: (listener) => runtimeListeners.delete(listener),
      },
      sendMessage: async (command) => {
        appendCommand(command);
        return { handled: true };
      },
    },
  });
  if (globalThis.chrome === undefined) {
    Object.defineProperty(globalThis, "chrome", { configurable: true, value: chromeApi });
  }
  Object.defineProperty(globalThis, "__huayiIsolatedWorldSentinel", {
    configurable: false,
    value: "huayi-e2e-isolated",
  });
})();
`;

function evaluationErrorMessage(prefix: string, details: { text: string }): string {
  return `${prefix}: ${details.text}`;
}

async function disposeIsolatedWorld(page: Page): Promise<void> {
  const harness = isolatedWorlds.get(page);
  isolatedWorlds.delete(page);
  if (harness !== undefined) {
    await harness.session.detach().catch(() => undefined);
  }
}

async function injectBuiltContentScriptInIsolatedWorld(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const [{ frameTree }, contentScript] = await Promise.all([
    session.send("Page.getFrameTree"),
    readFile(builtContentScript, "utf8"),
  ]);
  const { executionContextId } = await session.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id,
    worldName: isolatedWorldName,
  });

  const bootstrapResult = await session.send("Runtime.evaluate", {
    awaitPromise: true,
    contextId: executionContextId,
    expression: isolatedRuntimeBootstrap,
    returnByValue: true,
  });
  if (bootstrapResult.exceptionDetails !== undefined) {
    await session.detach();
    throw new Error(
      evaluationErrorMessage(
        "Unable to provision the isolated extension runtime",
        bootstrapResult.exceptionDetails,
      ),
    );
  }

  const contentResult = await session.send("Runtime.evaluate", {
    awaitPromise: true,
    contextId: executionContextId,
    expression: `${contentScript}\nObject.defineProperty(globalThis, "__huayiIsolatedContentScriptExecuted", { value: true });\ndocument.documentElement.dataset.huayiIsolatedContentScript = "executed";`,
    returnByValue: true,
  });
  if (contentResult.exceptionDetails !== undefined) {
    await session.detach();
    throw new Error(
      evaluationErrorMessage(
        "Unable to execute the built content script",
        contentResult.exceptionDetails,
      ),
    );
  }
  isolatedWorlds.set(page, { executionContextId, session });
}

async function gotoWithIsolatedContentScript(page: Page, url: string): Promise<void> {
  await disposeIsolatedWorld(page);
  await page.goto(url);
  await injectBuiltContentScriptInIsolatedWorld(page);
}

async function reloadWithIsolatedContentScript(page: Page): Promise<void> {
  await disposeIsolatedWorld(page);
  await page.reload();
  await injectBuiltContentScriptInIsolatedWorld(page);
}

async function readIsolatedWorldProof(page: Page): Promise<IsolatedWorldProof> {
  const harness = isolatedWorlds.get(page);
  if (harness === undefined) {
    throw new Error("The isolated extension world is not installed.");
  }
  const evaluation = await harness.session.send("Runtime.evaluate", {
    contextId: harness.executionContextId,
    expression: `({
      contentScriptExecuted: globalThis.__huayiIsolatedContentScriptExecuted === true,
      playerPrivateApiVisible:
        typeof document.querySelector("#movie_player")?.getPlayerResponse === "function",
      sentinel: globalThis.__huayiIsolatedWorldSentinel,
    })`,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails !== undefined) {
    throw new Error(
      evaluationErrorMessage(
        "Unable to inspect the isolated extension world",
        evaluation.exceptionDetails,
      ),
    );
  }
  const value: unknown = evaluation.result.value;
  if (typeof value !== "object" || value === null) {
    throw new Error("The isolated extension world returned an invalid proof.");
  }
  const proof = value as Record<string, unknown>;
  if (
    typeof proof.contentScriptExecuted !== "boolean" ||
    typeof proof.playerPrivateApiVisible !== "boolean" ||
    typeof proof.sentinel !== "string"
  ) {
    throw new Error("The isolated extension world returned an incomplete proof.");
  }
  return {
    contentScriptExecuted: proof.contentScriptExecuted,
    playerPrivateApiVisible: proof.playerPrivateApiVisible,
    sentinel: proof.sentinel,
  };
}

async function installBuiltExtensionRoutes(page: Page): Promise<void> {
  await page.route("https://www.youtube.com/api/timedtext**", (route) => {
    const translated = new URL(route.request().url()).searchParams.get("tlang") === "zh-Hans";
    const shouldFail =
      translated &&
      new URL(page.url()).searchParams.get("caption-scenario") === "translated-failure";
    return route.fulfill({
      body: shouldFail
        ? "not-json3"
        : JSON.stringify({
            events: [
              { dDurationMs: 3_000, segs: [{ utf8: "调查仍处于" }], tStartMs: 2_000 },
              { dDurationMs: 3_000, segs: [{ utf8: "早期阶段。" }], tStartMs: 5_000 },
            ],
          }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("https://www.youtube.com/__huayi__/youtube-bridge.js", (route) =>
    route.fulfill({ contentType: "text/javascript", path: builtYouTubeBridge }),
  );
  await page.route("https://www.youtube.com/watch**", (route) =>
    route.fulfill({ contentType: "text/html", path: youtubeFixture }),
  );
}

function player(page: Page): Locator {
  return page.getByTestId("youtube-player");
}

function englishCaption(page: Page): Locator {
  return player(page).locator("[data-huayi-youtube-english]");
}

function translatedCaption(page: Page): Locator {
  return player(page).locator("[data-huayi-youtube-translated]");
}

function bilingualButton(page: Page): Locator {
  return player(page).getByRole("button", { name: "固定显示中文字幕" });
}

async function expectEnglishReady(page: Page): Promise<void> {
  await expect(englishCaption(page)).toHaveText("The investigation was still in its early stages.");
  await expect(bilingualButton(page)).toBeEnabled();
}

async function substringBounds(
  caption: Locator,
  substring: string,
): Promise<{ height: number; width: number; x: number; y: number }> {
  return caption.evaluate((element, selectedText) => {
    const node = element.firstChild;
    const text = node?.textContent ?? "";
    const start = text.indexOf(selectedText);
    if (node === null || start < 0) {
      throw new Error(`Unable to find ${selectedText} in the rendered English sentence.`);
    }
    const range = element.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + selectedText.length);
    const bounds = range.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y };
  }, substring);
}

test.beforeEach(async ({ page }) => {
  await installBuiltExtensionRoutes(page);
  await gotoWithIsolatedContentScript(page, youtubeWatchUrl);
});

test.afterEach(async ({ page }) => {
  await disposeIsolatedWorld(page);
});

test("uses the built MAIN bridge to replace native captions with selectable English", async ({
  page,
}) => {
  await expect(page.locator("html")).toHaveAttribute(
    "data-huayi-isolated-content-script",
    "executed",
  );
  await expect(readIsolatedWorldProof(page)).resolves.toEqual({
    contentScriptExecuted: true,
    playerPrivateApiVisible: false,
    sentinel: "huayi-e2e-isolated",
  });
  await expect(
    page.evaluate(() => ({
      contentScriptExecuted: "__huayiIsolatedContentScriptExecuted" in globalThis,
      sentinel: "__huayiIsolatedWorldSentinel" in globalThis,
    })),
  ).resolves.toEqual({ contentScriptExecuted: false, sentinel: false });
  await expectEnglishReady(page);

  await expect(page.getByTestId("native-caption-container")).toHaveCSS("visibility", "hidden");
  await expect(translatedCaption(page)).toBeHidden();
  await expect(
    page.locator(
      '[data-timedtext-request="source"][data-has-po-token="false"][data-transport="fetch"]',
    ),
  ).not.toHaveCount(0);
  await expect(
    page.locator(
      '[data-timedtext-request="translated"][data-has-po-token="false"][data-transport="xhr"]',
    ),
  ).not.toHaveCount(0);

  await expect(player(page).getByText("译", { exact: true })).toHaveCount(0);
  await expect(player(page).getByText("整条字幕", { exact: true })).toHaveCount(0);
  await expect(player(page).locator("[data-huayi-youtube-picker-host]")).toHaveCount(0);
});

test("pins bilingual subtitles and treats F8 as a temporary reveal with blur cleanup", async ({
  page,
}) => {
  await expectEnglishReady(page);
  const control = bilingualButton(page);
  const translated = translatedCaption(page);

  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await expect(translated).toHaveText("调查仍处于早期阶段。");
  await expect(translated).toBeVisible();

  await control.click();
  await expect(translated).toBeHidden();
  await page.keyboard.down("F8");
  await expect(page.locator("[data-youtube-type-to-search]")).toHaveCount(0);
  await expect(translated).toBeVisible();
  await page.keyboard.up("F8");
  await expect(translated).toBeHidden();

  await page.keyboard.down("F8");
  await expect(translated).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(translated).toBeHidden();
  await page.keyboard.up("F8");
});

test("routes native double-click and drag selections with the frozen internal sentence", async ({
  page,
}) => {
  await expectEnglishReady(page);
  const english = englishCaption(page);
  const word = await substringBounds(english, "investigation");
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);

  await expect(toolbar(page)).toBeVisible();
  await expect(page.getByTestId("youtube-video")).toHaveAttribute("data-pause-count", "1");
  await expect(page.locator('[data-native-command="WARMUP_HOST"]')).toHaveCount(1);
  await toolbar(page).locator('[data-action="translate"]').click();
  const wordRequest = await expectAnalyzeRequest(page, "word", "translate");
  await expect(wordRequest).toHaveAttribute("data-selection-text", "investigation");
  await expect(wordRequest).toHaveAttribute(
    "data-analysis-context",
    "The investigation was still in its early stages.",
  );
  await expect(wordRequest).toHaveAttribute(
    "data-sentence-context",
    "The investigation was still in its early stages.",
  );

  await reloadWithIsolatedContentScript(page);
  await expectEnglishReady(page);
  const phraseCaption = englishCaption(page);
  const phrase = await substringBounds(phraseCaption, "early stages");
  const y = phrase.y + phrase.height / 2;
  await page.mouse.move(phrase.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(phrase.x + phrase.width - 1, y, { steps: 10 });
  await page.mouse.up();

  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).locator('[data-action="explain"]').click();
  const phraseRequest = await expectAnalyzeRequest(page, "phrase", "explain");
  await expect(phraseRequest).toHaveAttribute("data-selection-text", "early stages");
  await expect(phraseRequest).toHaveAttribute(
    "data-sentence-context",
    "The investigation was still in its early stages.",
  );

  await reloadWithIsolatedContentScript(page);
  await expectEnglishReady(page);
  const sentenceCaption = englishCaption(page);
  const sentenceText = "The investigation was still in its early stages.";
  const sentence = await substringBounds(sentenceCaption, sentenceText);
  const sentenceY = sentence.y + sentence.height / 2;
  await page.mouse.move(sentence.x + 1, sentenceY);
  await page.mouse.down();
  await page.mouse.move(sentence.x + sentence.width - 1, sentenceY, { steps: 16 });
  await page.mouse.up();

  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).locator('[data-action="translate"]').click();
  const sentenceRequest = await expectAnalyzeRequest(page, "sentence", "translate");
  await expect(sentenceRequest).toHaveAttribute("data-selection-text", sentenceText);
  await expect(sentenceRequest).toHaveAttribute("data-sentence-context", "");
});

test("fails closed when the source track is invalid and restores native captions", async ({
  page,
}) => {
  await gotoWithIsolatedContentScript(page, `${youtubeWatchUrl}&caption-scenario=source-failure`);

  await expect(page.locator('[data-timedtext-request="source"]')).not.toHaveCount(0);
  await expect(player(page).locator("[data-huayi-youtube-subtitle-surface]")).toHaveCount(0);
  await expect(page.getByTestId("native-caption-container")).toHaveCSS("visibility", "visible");
});

test("keeps custom English and disables 中 when the translated track fails", async ({ page }) => {
  await gotoWithIsolatedContentScript(
    page,
    `${youtubeWatchUrl}&caption-scenario=translated-failure`,
  );

  await expect(englishCaption(page)).toHaveText("The investigation was still in its early stages.");
  await expect(page.locator('[data-timedtext-request="translated"]')).not.toHaveCount(0);
  await expect(bilingualButton(page)).toBeDisabled();
  await expect(translatedCaption(page)).toBeHidden();
  await expect(page.getByTestId("native-caption-container")).toHaveCSS("visibility", "hidden");
});

test("resets bilingual state on SPA navigation and survives theater and fullscreen layouts", async ({
  page,
}) => {
  await expectEnglishReady(page);
  await bilingualButton(page).click();
  await expect(translatedCaption(page)).toBeVisible();

  await page.evaluate(() => document.dispatchEvent(new Event("yt-page-data-updated")));
  await expect(bilingualButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(translatedCaption(page)).toBeVisible();
  await expect(page.locator('[data-timedtext-request="source"]')).toHaveCount(1);
  await expect(page.locator('[data-timedtext-request="translated"]')).toHaveCount(1);

  await page.getByTestId("navigate-video").click({ force: true });
  await expect(page).toHaveURL(/\/watch\?v=video-2$/u);
  await expectEnglishReady(page);
  await expect(bilingualButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(translatedCaption(page)).toBeHidden();

  for (const mode of ["theater", "fullscreen"] as const) {
    await page.getByTestId(`${mode}-mode`).click({ force: true });
    await expect(player(page).locator("[data-huayi-youtube-subtitle-surface]")).toBeVisible();
    await expect(englishCaption(page)).toHaveText(
      "The investigation was still in its early stages.",
    );
  }
});
