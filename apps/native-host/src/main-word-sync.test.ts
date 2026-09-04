import { lstat } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  createNativeHostWordSyncFixture as createFixture,
  disposeNativeHostWordSyncFixtures,
} from "./main-word-sync.test-support.js";
import { WordSyncStateStore } from "./word-sync/word-sync-state.js";

const syncRequest = {
  requestId: "sync-shared-macos",
  schemaVersion: 7,
  type: "word-sync-poll",
} as const;

afterEach(disposeNativeHostWordSyncFixtures);

describe("native host word-sync bootstrap", () => {
  it.each([0, 1_200])(
    "shares one Eudic executor and awaits persisted status with a %i ms write delay",
    async (saveDelayMs) => {
      const fixture = await createFixture({ saveDelayMs });
      try {
        expect(
          await fixture.dispatch({
            language: "en",
            requestId: "check-shared-macos",
            schemaVersion: 7,
            type: "check-word",
            word: "investigation",
          }),
        ).toMatchObject({ requestId: "check-shared-macos", type: "word-status" });
        expect(await fixture.dispatch(syncRequest)).toMatchObject({
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
      } finally {
        await fixture.dispose();
      }
      await expect(lstat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("returns a persistence error terminal instead of waiting for a success event", async () => {
    const fixture = await createFixture({ failSave: true });
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

  it("does not remove or recreate the fixture directory while an aborted poll still writes", async () => {
    const fixture = await createFixture({ saveDelayMs: 1_200 });
    fixture.dispatcher.dispatch(syncRequest, () => undefined);
    await fixture.firstSaveStarted;

    await fixture.dispose();
    await fixture.drain();

    await expect(lstat(fixture.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
