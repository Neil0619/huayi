import { test, type CDPSession, type Page } from "@playwright/test";

// Opt-in CI comparisons only: the ordinary quality gate retains its original execution.
if (process.env.HUAYI_QUERY_SOFTWARE_RENDERING === "1") {
  test.use({ launchOptions: { args: ["--disable-gpu"] } });
}
if (process.env.HUAYI_QUERY_TIMING_DIAGNOSTICS === "1") {
  test.use({
    headless: process.env.HUAYI_QUERY_HEADFUL_DIAGNOSTIC !== "1",
  });
  const profilers = new WeakMap<Page, CDPSession>();
  const timelines = new WeakMap<Page, unknown[]>();
  test.beforeEach(async ({ page }, info) => {
    const popup = info.title.startsWith("makes popup");
    if (!info.title.startsWith("keeps focus") && !popup) return;
    const profiler = await page.context().newCDPSession(page);
    profilers.set(page, profiler);
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.start");
    if (info.repeatEachIndex === 0 || popup) {
      const events: unknown[] = [];
      timelines.set(page, events);
      profiler.on("Tracing.dataCollected", (event: { value: unknown[] }) => {
        events.push(...event.value);
      });
      await profiler.send("Tracing.start", {
        categories:
          "devtools.timeline,blink.user_timing,fonts,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack",
        transferMode: "ReportEvents",
      });
    }
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
    if (!info.title.startsWith("keeps focus") && !info.title.startsWith("makes popup")) return;
    const profiler = profilers.get(page);
    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");
      await info.attach("query-cpu-profile", {
        contentType: "application/json",
        body: JSON.stringify(profile),
      });
      const events = timelines.get(page);
      if (events) {
        const complete = new Promise<void>((resolve) => {
          profiler.once("Tracing.tracingComplete", () => resolve());
        });
        await profiler.send("Tracing.end");
        await complete;
        await info.attach("query-rendering-timeline", {
          contentType: "application/json",
          body: JSON.stringify({ traceEvents: events }),
        });
      }
      await profiler.detach();
    }
    const timing = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      diagnostics: Reflect.get(window, "__seenSaidQueryTiming"),
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      controlsMs: Number(document.documentElement.dataset.controlsMs),
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
    if (info.repeatEachIndex === 0) {
      const browser = page.context().browser();
      if (!browser) throw new Error("GPU diagnosis requires an owned browser");
      const inspector = await browser.newBrowserCDPSession();
      const { gpu } = await inspector.send("SystemInfo.getInfo");
      await info.attach("query-gpu-environment", {
        contentType: "application/json",
        body: JSON.stringify(gpu),
      });
      await inspector.detach();
    }
  });
}
