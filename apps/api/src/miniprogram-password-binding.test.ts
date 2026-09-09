import { afterEach, describe, expect, it } from "vitest";
import { miniProgramRoutes } from "@huayi/cloud-contracts";
import {
  createMiniProgramJourneyFixture,
  journeyPassword,
  type MiniProgramJourneyFixture,
} from "./test-support/miniprogram-journey-fixture.js";
import {
  addWord,
  beginMini,
  jsonRequest,
  listWords,
  loginWeb,
  miniHeaders,
} from "./test-support/miniprogram-journey-requests.js";

let fixture: MiniProgramJourneyFixture | undefined;
afterEach(async () => fixture?.db.close());
const route = miniProgramRoutes.loginAndLink;

describe("log in to an existing account and link WeChat", () => {
  it("uses one password login to share the existing owner and recovers a lost response through WeChat login", async () => {
    const f = (fixture = await createMiniProgramJourneyFixture());
    const owner = await f.seedWebAccount();
    const headers = await loginWeb(f, owner.email);
    const word = await addWord(f, headers, "remember");
    const start = await beginMini(f, "login-and-link");
    if (start.state !== "onboarding") throw new Error("Expected a new WeChat identity.");
    const input = {
      ticket: start.ticket,
      email: owner.email,
      password: journeyPassword,
      confirmed: true,
    };
    const denied = await jsonRequest(f, route, {}, { ...input, password: "wrong-password" }, 401);
    expect(await denied.json()).toMatchObject({
      error: {
        code: "authentication_required",
        message: "Account login or linking could not be completed.",
      },
    });
    expect(
      (await f.db.query("SELECT count(*)::integer AS count FROM wechat_identities")).rows,
    ).toEqual([{ count: 0 }]);
    const response = await jsonRequest(f, route, {}, input);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    const session = await response.json();
    expect(session).toMatchObject({ state: "authenticated", token: expect.any(String) });
    expect(JSON.stringify(session)).not.toMatch(/refresh|password|csrf|email/i);
    const linked = miniHeaders(session.token);
    expect(
      await (await f.app.request(miniProgramRoutes.account, { headers: linked })).json(),
    ).toMatchObject({ id: owner.owner, email: owner.email, linkedToWeb: true });
    expect((await listWords(f, linked)).items.map((item) => item.word.id)).toEqual([word.word.id]);
    expect((await f.db.query("SELECT count(*)::integer AS count FROM user_profiles")).rows).toEqual(
      [{ count: 1 }],
    );
    expect((await f.db.query("SELECT count(*)::integer AS count FROM web_sessions")).rows).toEqual([
      { count: 1 },
    ]);
    expect((await f.db.query("SELECT count(*)::integer AS count FROM quota_grants")).rows).toEqual([
      { count: 0 },
    ]);
    expect((await f.db.query("SELECT reauthenticated_at FROM miniprogram_sessions")).rows).toEqual([
      { reauthenticated_at: null },
    ]);
    await jsonRequest(f, route, {}, input, 401);
    const recovered = await beginMini(f, "login-and-link");
    expect(recovered.state).toBe("authenticated");
  });

  it.each(["expired", "disabled", "deleted", "password-removed"])(
    "does not link a %s account or ticket even with valid provider credentials",
    async (scenario) => {
      const f = (fixture = await createMiniProgramJourneyFixture());
      const owner = await f.seedWebAccount();
      const start = await beginMini(f, scenario);
      if (start.state !== "onboarding") throw new Error("Expected onboarding.");
      if (scenario === "expired")
        await f.db.query("UPDATE wechat_onboarding SET expires_at=now()-interval '1 second'");
      if (scenario === "disabled")
        await f.db.query("UPDATE user_profiles SET status='disabled' WHERE user_id=$1", [
          owner.owner,
        ]);
      if (scenario === "deleted")
        await f.db.query("DELETE FROM user_profiles WHERE user_id=$1", [owner.owner]);
      if (scenario === "password-removed")
        await f.db.query("DELETE FROM account_sign_in_methods WHERE owner_user_id=$1", [
          owner.owner,
        ]);
      await jsonRequest(
        f,
        route,
        {},
        { ticket: start.ticket, email: owner.email, password: journeyPassword, confirmed: true },
        401,
      );
      expect(
        (await f.db.query("SELECT count(*)::integer AS count FROM wechat_identities")).rows,
      ).toEqual([{ count: 0 }]);
      expect(
        (await f.db.query("SELECT count(*)::integer AS count FROM miniprogram_sessions")).rows,
      ).toEqual([{ count: 0 }]);
    },
  );

  it.each(["owner-linked", "wechat-linked", "approved-other-owner"])(
    "preserves existing ownership when %s",
    async (scenario) => {
      const f = (fixture = await createMiniProgramJourneyFixture());
      const first = await f.seedWebAccount();
      const second = await f.seedWebAccount();
      const initial = await beginMini(f, "first-wechat");
      const next = await beginMini(
        f,
        scenario === "wechat-linked" ? "first-wechat" : "other-wechat",
      );
      if (initial.state !== "onboarding" || next.state !== "onboarding")
        throw new Error("Expected onboarding.");
      if (scenario === "approved-other-owner") {
        const web = await loginWeb(f, first.email);
        await jsonRequest(
          f,
          miniProgramRoutes.approveBinding,
          web,
          { bindingCode: next.bindingCode, confirmed: true },
          204,
        );
      } else await f.mini.loginAndLink(initial.ticket, first.owner);
      const owner = scenario === "owner-linked" ? first : second;
      const before = (
        await f.db.query("SELECT app_id,subject_hash,owner_user_id FROM wechat_identities")
      ).rows;
      await jsonRequest(
        f,
        route,
        {},
        { ticket: next.ticket, email: owner.email, password: journeyPassword, confirmed: true },
        401,
      );
      expect(
        (await f.db.query("SELECT app_id,subject_hash,owner_user_id FROM wechat_identities")).rows,
      ).toEqual(before);
      expect(
        (await f.db.query("SELECT count(*)::integer AS count FROM user_profiles")).rows,
      ).toEqual([{ count: 2 }]);
    },
  );

  it("allows ordinary logged-in Web confirmation while keeping Origin, CSRF and session checks", async () => {
    const f = (fixture = await createMiniProgramJourneyFixture());
    const owner = await f.seedWebAccount();
    const headers = await loginWeb(f, owner.email);
    const start = await beginMini(f, "web-confirmation");
    if (start.state !== "onboarding") throw new Error("Expected onboarding.");
    const input = { bindingCode: start.bindingCode, confirmed: true };
    await jsonRequest(
      f,
      miniProgramRoutes.approveBinding,
      { ...headers, origin: "https://wrong.example.test" },
      input,
      403,
    );
    await jsonRequest(
      f,
      miniProgramRoutes.approveBinding,
      { ...headers, "x-csrf-token": "wrong-proof" },
      input,
      403,
    );
    await jsonRequest(f, miniProgramRoutes.approveBinding, {}, input, 401);
    await jsonRequest(f, miniProgramRoutes.approveBinding, headers, input, 204);
    expect(await f.mini.bindingStatus(start.ticket)).toEqual({ status: "approved" });
  });
});
