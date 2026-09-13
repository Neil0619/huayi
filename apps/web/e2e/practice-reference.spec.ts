import { expect, test, type Route } from "@playwright/test";
import {
  learningTaskCommandSchema,
  learningTaskSnapshotSchema,
  practiceReferenceDetailSchema,
  practiceReferenceRequestSchema,
} from "@huayi/cloud-contracts";
import { createPracticeProgressionAuthority } from "./support/practice-progression-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";

const example = {
  sentence: "I need at least two days to finish the report.",
  translationZh: "我至少需要两天来完成报告。",
  usageNoteZh: "用 at least 说明最低时间要求。",
};
for (const width of [390, 1440]) {
  test(`reference opens on demand and preserves typing at ${width}px`, async ({ page }, info) => {
    const authority = createPracticeProgressionAuthority();
    await authority.install(page);
    let ready = false,
      viewedAt: string | null = null,
      generations = 0;
    let complete: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const json = (route: Route, value: unknown) =>
      route.fulfill({
        contentType: "application/json",
        headers: cloudCors(route.request().headers().origin) ?? {},
        body: JSON.stringify(value),
      });
    const session = () => {
      const value = authority.facts().sessions[0];
      if (!value?.workspace) throw new Error("Missing current practice");
      return value;
    };
    const detail = () =>
      practiceReferenceDetailSchema.parse({
        version: 1,
        sessionId: session().id,
        revision: session().revision,
        controlRevision: session().workspace?.controlRevision ?? 0,
        ordinal: 0,
        ready,
        viewedAt,
        availability: "available",
        reference: viewedAt ? example : null,
      });
    const snapshot = (state: "queued" | "completed") =>
      learningTaskSnapshotSchema.parse({
        version: 2,
        id: "reference-task",
        kind: "sentence-reference",
        subjectId: session().id,
        state,
        cursor: state === "completed" ? 1 : 0,
        timings: {},
        error: null,
        createdAt: session().createdAt,
        updatedAt: session().updatedAt,
        output: state === "completed" ? { type: "practice.updated", session: session() } : null,
      });
    await page.route("https://api.huayi.invalid/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() === "OPTIONS") return route.fallback();
      if (path.endsWith("/reference")) return json(route, detail());
      if (path.endsWith("/reference/reveal")) {
        const input = practiceReferenceRequestSchema.parse(request.postDataJSON());
        expect(input.expectedRevision).toBe(session().revision);
        expect(input.expectedControlRevision).toBe(session().workspace?.controlRevision ?? 0);
        expect(request.headers()["x-csrf-token"]).toBeTruthy();
        expect(request.headers()["idempotency-key"]).toBeTruthy();
        const saved = session();
        if (!saved.workspace) throw new Error("Missing workspace");
        saved.revision += 1;
        saved.workspace.controlRevision = (saved.workspace.controlRevision ?? 0) + 1;
        viewedAt = new Date().toISOString();
        return json(route, detail());
      }
      if (path === "/v2/learning-tasks" && request.method() === "POST") {
        const command = learningTaskCommandSchema.parse(request.postDataJSON());
        if (command.kind !== "sentence-reference") return route.fallback();
        generations += 1;
        expect(command.sessionId).toBe(session().id);
        expect(command.input).not.toHaveProperty("answer");
        return json(route, snapshot("queued"));
      }
      if (path === "/v2/learning-tasks/reference-task/events") {
        await waiting;
        ready = true;
        const done = snapshot("completed");
        return route.fulfill({
          contentType: "text/event-stream",
          headers: cloudCors(request.headers().origin) ?? {},
          body: `event: learning-task\nid: 1\ndata: ${JSON.stringify({ version: 2, taskId: done.id, cursor: 1, payload: done.output })}\n\nevent: task-status\ndata: ${JSON.stringify(done)}\n\n`,
        });
      }
      return route.fallback();
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto("https://web.huayi.invalid/practice");
    await page.getByRole("button", { name: "开始今日练习", exact: true }).click();
    const button = page.getByRole("button", { name: "查看参考表达", exact: true });
    await expect(button).toBeEnabled();
    expect(generations).toBe(0);
    await expect(page.getByText(example.sentence, { exact: true })).toHaveCount(0);
    const input = page.getByRole("textbox", { name: "你的英文句子", exact: true });
    await input.fill("I need");
    await button.click();
    await expect(page.getByRole("button", { name: "正在准备参考表达…" })).toBeDisabled();
    for (const draft of ["I need ", "I need t", "I need ti"]) {
      await input.fill(draft);
      await expect.poll(() => session().workspace?.draft).toBe(draft);
      await expect(input).toBeFocused();
      await expect(page.locator(".practice-session h2")).toHaveText("at least");
      await expect(page.getByText("正在读取练习信息…", { exact: true })).toHaveCount(0);
    }
    complete();
    await expect(page.getByText(example.sentence, { exact: true })).toBeVisible();
    await expect(input).toHaveValue("I need ti");
    await expect(input).toBeFocused();
    const collapse = page.getByRole("button", { name: "收起参考表达", exact: true });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(session().attempts ?? []).toHaveLength(0);
    expect(authority.facts().ratings).toBe(0);
    expect(generations).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator(".practice-reference").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("reference-expanded.png"), fullPage: true });
    await page
      .locator(".practice-reference")
      .screenshot({ path: info.outputPath("reference-card.png") });
    await collapse.click();
    await expect(page.getByText(example.sentence, { exact: true })).toHaveCount(0);
    await button.focus();
    await button.press("Enter");
    await expect(page.getByText(example.sentence, { exact: true })).toBeVisible();
    expect(generations).toBe(1);
    expect(errors).toEqual([]);
  });
}
