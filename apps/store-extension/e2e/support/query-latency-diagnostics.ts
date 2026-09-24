import { test } from "@playwright/test";

// Opt-in CI diagnosis only: the ordinary quality gate retains its original execution.
if (process.env.HUAYI_QUERY_TIMING_DIAGNOSTICS === "1") {
  test.beforeEach(async ({ page }, info) => {
    if (!info.title.startsWith("keeps focus")) return;
    await page.addInitScript(() => {
      const frames: { scheduled: number; fired: number; finished: number }[] = [];
      const layouts: { start: number; duration: number; element: string }[] = [];
      const longTasks: { start: number; duration: number }[] = [];
      const nativeFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        const scheduled = performance.now();
        return nativeFrame((timestamp) => {
          const fired = performance.now();
          try {
            callback(timestamp);
          } finally {
            if (frames.length < 2_000)
              frames.push({ scheduled, fired, finished: performance.now() });
          }
        });
      };
      const nativeBounds = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const start = performance.now();
        const result = nativeBounds.call(this);
        if (layouts.length < 2_000)
          layouts.push({
            start,
            duration: performance.now() - start,
            element: this.hasAttribute("data-huayi-store-overlay") ? "overlay" : this.tagName,
          });
        return result;
      };
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (longTasks.length < 200)
              longTasks.push({ start: entry.startTime, duration: entry.duration });
        }).observe({ type: "longtask", buffered: true });
      }
      Reflect.set(window, "__seenSaidQueryTiming", { frames, layouts, longTasks });
    });
  });

  test.afterEach(async ({ page }, info) => {
    if (!info.title.startsWith("keeps focus")) return;
    const timing = await page.evaluate(() => ({
      diagnostics: Reflect.get(window, "__seenSaidQueryTiming"),
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      hitMs: Number(document.body.dataset.resultMs),
      increments: performance
        .getEntriesByName("seen-said:query:increment-to-paint")
        .map((entry) => ({ start: entry.startTime, duration: entry.duration })),
      resources: performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        start: entry.startTime,
        duration: entry.duration,
      })),
    }));
    await info.attach("query-timing-breakdown", {
      contentType: "application/json",
      body: JSON.stringify(timing),
    });
  });
}
