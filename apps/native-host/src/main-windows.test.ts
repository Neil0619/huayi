import { lstat } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  createNativeHostWordSyncFixture,
  disposeNativeHostWordSyncFixtures,
} from "./main-word-sync.test-support.js";
import { WordSyncStateStore } from "./word-sync/word-sync-state.js";

const syncRequest = {
  requestId: "word-sync-win",
  schemaVersion: 7,
  type: "word-sync-poll",
} as const;

afterEach(disposeNativeHostWordSyncFixtures);

describe("Windows DeepSeek native host", () => {
  it.each([0, 1_200])(
    "reports DeepSeek health and supports the Eudic wordbook with a %i ms write delay",
    async (saveDelayMs) => {
      const fixture = await createNativeHostWordSyncFixture({
        platformMode: "windows-deepseek",
        saveDelayMs,
      });
      try {
        const [health, wordbook, wordSync] = await Promise.all([
          fixture.dispatch({ requestId: "health-win", schemaVersion: 7, type: "health" }),
          fixture.dispatch({
            language: "en",
            requestId: "word-win",
            schemaVersion: 7,
            type: "check-word",
            word: "investigation",
          }),
          fixture.dispatch(syncRequest),
        ]);
        expect(health).toMatchObject({
          codexVersion: null,
          model: "deepseek-v4-flash",
          provider: "deepseek-chat-completions",
          ready: true,
          requestId: "health-win",
          type: "health-result",
        });
        expect(wordbook).toMatchObject({
          presence: "absent",
          requestId: "word-win",
          type: "word-status",
        });
        expect(wordSync).toMatchObject({
          historyComplete: true,
          lastPollSucceeded: true,
          pendingCount: 0,
          requestId: syncRequest.requestId,
          scanInProgress: false,
          type: "word-sync-status",
        });
        expect(await new WordSyncStateStore({ path: fixture.statePath }).load()).toMatchObject({
          historyComplete: true,
          lastPollSucceeded: true,
          pending: [],
          scan: null,
        });
        expect(fixture.executeEudicOperation).toHaveBeenCalledTimes(2);
        expect(fixture.eudicAuthorizationReader.read).toHaveBeenCalledTimes(2);
        expect(fixture.eudicFetch).toHaveBeenCalledTimes(2);
      } finally {
        await fixture.dispose();
      }
      await expect(lstat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("returns a persistence error terminal instead of waiting for successful status", async () => {
    const fixture = await createNativeHostWordSyncFixture({
      failSave: true,
      platformMode: "windows-deepseek",
    });
    try {
      expect(await fixture.dispatch(syncRequest)).toMatchObject({
        error: { code: "INTERNAL_ERROR" },
        requestId: syncRequest.requestId,
        type: "error",
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("drains an aborted poll before removing its temporary state directory", async () => {
    const fixture = await createNativeHostWordSyncFixture({
      platformMode: "windows-deepseek",
      saveDelayMs: 1_200,
    });
    fixture.dispatcher.dispatch(syncRequest, () => undefined);
    await fixture.firstSaveStarted;

    await fixture.dispose();
    await fixture.drain();

    await expect(lstat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
