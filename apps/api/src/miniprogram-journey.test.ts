import {
  miniProgramAccountSchema,
  miniProgramRoutes,
  miniProgramSessionSchema,
  wordCatalogDetailSchema,
} from "@huayi/cloud-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { hashSecret } from "./security.js";
import {
  createMiniProgramJourneyFixture,
  journeyPepper,
  type MiniProgramJourneyFixture,
} from "./test-support/miniprogram-journey-fixture.js";
import {
  addWord,
  archiveWord,
  beginMini,
  jsonRequest,
  listWords,
  loginWeb,
  miniHeaders,
  openMini,
  reauthenticateWeb,
  readStatus,
} from "./test-support/miniprogram-journey-requests.js";

import { exportWords, deleteAccount } from "./test-support/miniprogram-journey-assertions.js";

let fixture: MiniProgramJourneyFixture | undefined;
afterEach(async () => fixture?.db.close());

describe("mini-program journeys on the complete current migration chain", () => {
  it("independently opens, paginates and archives owner data, exports real content, revokes sessions and deletes only that account", async () => {
    const f = (fixture = await createMiniProgramJourneyFixture());
    const learner = await openMini(f, "independent-learner");
    const stranger = await openMini(f, "independent-stranger");
    expect(learner.account).toMatchObject({ email: null, linkedToWeb: false });
    expect(
      (
        await f.db.query("SELECT count(*)::integer AS count FROM quota_grants WHERE user_id=$1", [
          learner.account.id,
        ])
      ).rows,
    ).toEqual([{ count: 1 }]);
    const foreign = await addWord(f, stranger.headers, "foreign-private-word");
    const words = [];
    for (let i = 0; i < 23; i += 1) words.push(await addWord(f, learner.headers, `remember-${i}`));
    const first = await listWords(f, learner.headers);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await listWords(
      f,
      learner.headers,
      `?cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    );
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item) => item.word.id).sort()).toEqual(
      words.map((item) => item.word.id).sort(),
    );
    expect((await listWords(f, stranger.headers)).items.map((item) => item.word.id)).toEqual([
      foreign.word.id,
    ]);
    const target = words[0];
    if (!target) throw new Error("Missing created word.");
    for (const path of [`/v1/words/${target.word.id}`, `/v2/words/${target.word.id}`])
      await readStatus(f, path, stranger.headers, 404);
    await jsonRequest(
      f,
      `/v2/words/${target.word.id}/archive`,
      { ...stranger.headers, "if-match": '"1"' },
      { archived: true, expectedRevision: 1 },
      404,
    );
    const archived = await archiveWord(f, learner.headers, target.word.id, 1, true);
    expect(archived).toMatchObject({ word: { revision: 2 }, archivedAt: expect.any(String) });
    expect((await listWords(f, learner.headers, "?archived=true")).items).toEqual([archived]);
    expect((await listWords(f, learner.headers, "?limit=100")).items).toHaveLength(22);
    const detail = wordCatalogDetailSchema.parse(
      await (await readStatus(f, `/v2/words/${target.word.id}`, learner.headers, 200)).json(),
    );
    expect(detail.contexts.items).toHaveLength(1);
    const exported = await exportWords(
      f,
      learner.headers,
      words.map((word) => word.word.id),
    );
    expect(exported.words.find((word) => word.word.id === target.word.id)).toHaveProperty(
      "archivedAt",
      archived.archivedAt,
    );
    const contentPath = `/v1/miniprogram/data-exports/${exported.id}/content`;
    await readStatus(f, contentPath, learner.headers, 403);
    await jsonRequest(
      f,
      "/v1/account-deletion",
      learner.headers,
      { confirmation: "delete-account" },
      403,
    );
    expect(f.storageFetch).not.toHaveBeenCalled();
    await jsonRequest(
      f,
      miniProgramRoutes.reauthenticate,
      learner.headers,
      { code: stranger.code },
      401,
    );
    await jsonRequest(
      f,
      miniProgramRoutes.reauthenticate,
      learner.headers,
      { code: learner.code },
      204,
    );
    await jsonRequest(
      f,
      miniProgramRoutes.reauthenticate,
      stranger.headers,
      { code: stranger.code },
      204,
    );
    await readStatus(f, contentPath, stranger.headers, 404);
    await jsonRequest(
      f,
      `/v1/account-data-exports/${exported.id}/download-url`,
      stranger.headers,
      {},
      404,
    );
    expect(
      await (await readStatus(f, "/v1/account-data-exports/current", stranger.headers, 200)).json(),
    ).toEqual({ job: null });
    expect(f.signedUrls.create).not.toHaveBeenCalled();
    const download = await readStatus(f, contentPath, learner.headers, 200);
    expect(download.headers.get("cache-control")).toContain("no-store");
    expect(download.headers.get("location")).toBeNull();
    expect(await download.text()).toBe(new TextDecoder().decode(exported.bytes));
    await f.db.query(
      "UPDATE miniprogram_sessions SET reauthenticated_at=now()-interval '16 minutes' WHERE token_hash=$1",
      [hashSecret(learner.token, journeyPepper)],
    );
    await readStatus(f, contentPath, learner.headers, 403);
    expect(f.storageFetch).toHaveBeenCalledOnce();
    await jsonRequest(
      f,
      `/v2/words/${target.word.id}/archive`,
      { ...learner.headers, "if-match": '"1"' },
      { archived: false, expectedRevision: 1 },
      409,
    );
    expect(await archiveWord(f, learner.headers, target.word.id, 2, false)).toMatchObject({
      archivedAt: null,
      word: { revision: 3 },
    });
    expect((await listWords(f, learner.headers, "?limit=100")).items).toHaveLength(23);
    expect((await listWords(f, learner.headers, "?archived=true")).items).toEqual([]);
    const next = await beginMini(f, learner.code);
    if (next.state !== "authenticated") throw new Error("Existing learner should log in directly.");
    const nextHeaders = miniHeaders(next.token);
    await jsonRequest(f, miniProgramRoutes.logout, learner.headers, {}, 204);
    await readStatus(f, miniProgramRoutes.account, learner.headers, 401);
    await readStatus(f, miniProgramRoutes.account, nextHeaders, 200);
    await jsonRequest(
      f,
      miniProgramRoutes.reauthenticate,
      nextHeaders,
      { code: learner.code },
      204,
    );
    await deleteAccount(f, learner.account.id, nextHeaders, [learner.headers, nextHeaders], false);
    expect((await listWords(f, stranger.headers)).items.map((item) => item.word.id)).toEqual([
      foreign.word.id,
    ]);
  });

  it("requires explicit recent Web confirmation, shares one owner without copying records, and revokes both identity types on linked-account deletion", async () => {
    const f = (fixture = await createMiniProgramJourneyFixture());
    const existing = await f.seedWebAccount();
    const unrelated = await f.seedWebAccount();
    const originalWeb = await loginWeb(f, existing.email);
    const otherWeb = await loginWeb(f, unrelated.email);
    const originalWord = await addWord(f, originalWeb, "existing-web-word");
    const foreign = await addWord(f, otherWeb, "other-web-private-word");
    const start = await beginMini(f, "linked-learner");
    if (start.state !== "onboarding") throw new Error("Expected optional binding choice.");
    await jsonRequest(
      f,
      miniProgramRoutes.onboard,
      {},
      { ticket: start.ticket, mode: "linked" },
      401,
    );
    await jsonRequest(
      f,
      miniProgramRoutes.approveBinding,
      originalWeb,
      { bindingCode: start.bindingCode, confirmed: true },
      401,
    );
    const web = await reauthenticateWeb(f, originalWeb);
    await readStatus(f, "/v2/words", originalWeb, 401);
    await jsonRequest(
      f,
      miniProgramRoutes.approveBinding,
      web,
      { bindingCode: start.bindingCode, confirmed: false },
      400,
    );
    await jsonRequest(
      f,
      miniProgramRoutes.approveBinding,
      { ...web, "x-csrf-token": otherWeb["x-csrf-token"] ?? "" },
      { bindingCode: start.bindingCode, confirmed: true },
      403,
    );
    await jsonRequest(
      f,
      miniProgramRoutes.approveBinding,
      { ...web, origin: "https://other.example.test" },
      { bindingCode: start.bindingCode, confirmed: true },
      403,
    );
    expect(
      await (
        await jsonRequest(f, miniProgramRoutes.bindingStatus, {}, { ticket: start.ticket })
      ).json(),
    ).toEqual({ status: "pending" });
    await jsonRequest(
      f,
      miniProgramRoutes.approveBinding,
      web,
      { bindingCode: start.bindingCode, confirmed: true },
      204,
    );
    expect(
      await (
        await jsonRequest(f, miniProgramRoutes.bindingStatus, {}, { ticket: start.ticket })
      ).json(),
    ).toEqual({ status: "approved" });
    const session = miniProgramSessionSchema.parse(
      await (
        await jsonRequest(
          f,
          miniProgramRoutes.onboard,
          {},
          { ticket: start.ticket, mode: "linked" },
        )
      ).json(),
    );
    const mini = miniHeaders(session.token);
    const account = miniProgramAccountSchema.parse(
      await (await readStatus(f, miniProgramRoutes.account, mini, 200)).json(),
    );
    expect(account).toEqual({ id: existing.owner, email: existing.email, linkedToWeb: true });
    expect((await f.db.query("SELECT count(*)::integer AS count FROM user_profiles")).rows).toEqual(
      [{ count: 2 }],
    );
    expect((await listWords(f, mini)).items.map((item) => item.word.id)).toEqual([
      originalWord.word.id,
    ]);
    const miniWord = await addWord(f, mini, "added-from-mini");
    expect((await listWords(f, web)).items.map((item) => item.word.id).sort()).toEqual(
      [originalWord.word.id, miniWord.word.id].sort(),
    );
    await readStatus(f, `/v2/words/${foreign.word.id}`, mini, 404);
    await jsonRequest(
      f,
      `/v2/words/${miniWord.word.id}/archive`,
      { ...otherWeb, "if-match": '"1"' },
      { archived: true, expectedRevision: 1 },
      404,
    );
    const exported = await exportWords(f, web, [originalWord.word.id, miniWord.word.id]);
    const contentPath = `/v1/miniprogram/data-exports/${exported.id}/content`;
    await readStatus(f, contentPath, mini, 403);
    await jsonRequest(f, miniProgramRoutes.reauthenticate, mini, { code: "linked-learner" }, 204);
    const downloaded = await readStatus(f, contentPath, mini, 200);
    expect(await downloaded.text()).toBe(new TextDecoder().decode(exported.bytes));
    await f.db.query(
      "UPDATE web_sessions SET reauthenticated_at=now()-interval '16 minutes' WHERE session_hash=$1",
      [hashSecret(web.cookie?.slice("huayi_session=".length) ?? "", journeyPepper)],
    );
    await jsonRequest(f, `/v1/account-data-exports/${exported.id}/download-url`, web, {}, 403);
    await jsonRequest(f, "/v1/account-deletion", web, { confirmation: "delete-account" }, 403);
    const newWeb = await reauthenticateWeb(f, web);
    const otherFresh = await reauthenticateWeb(f, otherWeb);
    await jsonRequest(
      f,
      `/v1/account-data-exports/${exported.id}/download-url`,
      otherFresh,
      {},
      404,
    );
    await jsonRequest(f, `/v1/account-data-exports/${exported.id}/download-url`, newWeb, {}, 200);
    const secondWeb = await loginWeb(f, existing.email);
    await jsonRequest(f, "/v1/auth/logout", secondWeb, {}, 204);
    await readStatus(f, "/v2/words", secondWeb, 401);
    await readStatus(f, "/v2/words", newWeb, 200);
    await readStatus(f, "/v2/words", mini, 200);
    await deleteAccount(f, existing.owner, newWeb, [newWeb, secondWeb, mini], true);
    expect((await listWords(f, otherFresh)).items.map((item) => item.word.id)).toEqual([
      foreign.word.id,
    ]);
  });
});
