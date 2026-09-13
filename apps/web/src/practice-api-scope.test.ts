import { expect, it, vi } from "vitest";
import { createPracticeApiScope } from "./practice-api-scope.js";
import type { PracticePageApi } from "./practice-page-api.js";
import { createWebPracticeApi } from "./practice-api.js";
import { teachingFixture } from "./practice-teaching.test-support.js";
import { practiceTarget } from "./practice-teaching.test-support.js";

it("rejects an old read across deactivation/reactivation and prevents its follow-up write", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const write = vi.fn();
  const api = {
    dailyQueue: () =>
      new Promise((r) => {
        resolve = r;
      }),
    startSentence: write,
  } as unknown as PracticePageApi;
  const scope = createPracticeApiScope(api);
  const chain = scope.api.dailyQueue().then(() => scope.api.startSentence("item", "key"));
  scope.deactivate();
  scope.activate();
  resolve({ items: [] });
  await expect(chain).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
  scope.deactivate();
  await expect(scope.api.startSentence("item", "key")).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});

it("does not dispatch an old teaching action after its CSRF read finishes on an unmounted surface", async () => {
  let csrf: (token: string) => void = () => undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(teachingFixture()));
  const api = createWebPracticeApi({
    apiOrigin: "https://practice.invalid",
    fetch,
    csrfToken: () =>
      new Promise((resolve) => {
        csrf = resolve;
      }),
  });
  const scope = createPracticeApiScope({ ...api, getLearningItem: vi.fn() });
  const pending = scope.api.teaching?.act(
    "teaching-session",
    { action: "reveal-hint", expectedRevision: 2, expectedControlRevision: 0, ordinal: 0 },
    "old-action",
  );
  scope.deactivate();
  csrf("csrf-after-navigation");
  await expect(pending).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it("retains composed library reads when only practice HTTP methods bind an abort signal", async () => {
  const api = Object.assign(
    createWebPracticeApi({
      apiOrigin: "https://practice.invalid",
      fetch: vi.fn(),
      csrfToken: async () => "csrf",
    }),
    {
      getLearningItem: vi.fn(async () => practiceTarget),
    },
  );
  const scope = createPracticeApiScope(api);
  expect(await scope.api.getLearningItem(practiceTarget.item.id)).toEqual(practiceTarget);
  scope.deactivate();
});
