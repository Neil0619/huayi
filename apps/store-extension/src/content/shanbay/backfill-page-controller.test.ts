import { describe, expect, it, vi } from "vitest";
import {
  accepted,
  firstWords,
  batch,
  button,
  textarea,
  feedback,
  flush,
  deferred,
  setup,
} from "./backfill-page.test-support.js";

describe("Store backfill page controller", () => {
  it("retries activation after an earlier unregistered page-ready reply finishes", async () => {
    const input = textarea();
    const pending = deferred();
    const { controller, sendMessage } = setup([batch(["apple"])]);
    sendMessage.mockReturnValueOnce(pending.promise);
    const starting = controller.start();
    await flush();
    await controller.activate();
    await controller.activate();
    pending.finish({ accepted: false, batch: null });
    await starting;
    await flush();
    expect(input.value).toBe("apple");
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not claim again if an in-flight activation already returned a batch", async () => {
    const input = textarea();
    const pending = deferred();
    const { controller, sendMessage } = setup([]);
    sendMessage.mockReturnValueOnce(pending.promise);
    const starting = controller.start();
    await controller.activate();
    pending.finish({ accepted: true, batch: batch(["apple"]) });
    await starting;
    await flush();
    expect(input.value).toBe("apple");
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("keeps an existing batch renewable when opening review and can continue it", async () => {
    vi.useFakeTimers();
    const input = textarea();
    const { controller, sendMessage, messages } = setup([]);
    sendMessage.mockResolvedValueOnce({ accepted: true, review: true, batch: batch(["apple"]) });
    await controller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(messages("store/backfill-renew")).toHaveLength(1);
    await controller.activate();
    expect(input.value).toBe("apple");
    expect(
      sendMessage.mock.calls.filter(
        ([message]) => (message as { type: string }).type === "store/backfill-page-ready",
      ),
    ).toHaveLength(1);
  });

  it.each(["rejection", "network"])(
    "ignores a late old-batch renewal %s after the next batch starts",
    async (failure) => {
      vi.useFakeTimers();
      const pending = deferred();
      const input = textarea();
      const submit = button();
      const { controller, sendMessage, messages } = setup([
        batch(["apple"]),
        batch(["water"], 200),
      ]);
      await controller.start();
      sendMessage.mockImplementationOnce(() =>
        pending.promise.then((value) => {
          if (failure === "network") throw new Error("offline");
          return value;
        }),
      );
      await vi.advanceTimersByTimeAsync(60_000);
      submit.click();
      input.value = "";
      feedback("添加完成（1/1）");
      await flush();
      expect(input.value).toBe("water");
      pending.finish({ accepted: false, batch: null });
      await flush();
      expect(messages("store/backfill-unknown")).toEqual([]);
      expect(input.value).toBe("water");
    },
  );

  it.each([false, true])(
    "ignores a late rejected receipt after stop, restarted=%s",
    async (restart) => {
      const pending = deferred();
      textarea();
      const submit = button();
      const { controller, messages } = setup([batch(["apple"]), batch(["water"], 200)], {
        resolve: () => pending.promise,
      });
      await controller.start();
      submit.click();
      feedback();
      await flush();
      controller.stop();
      if (restart) await controller.start();
      pending.finish({ accepted: false, batch: null });
      await flush();
      expect(messages("store/backfill-unknown")).toHaveLength(1);
      if (!restart) expect(document.querySelector("[data-huayi-backfill]")).toBeNull();
    },
  );

  it("opens review after an earlier unregistered startup reply finishes", async () => {
    const pending = deferred();
    const { controller, sendMessage } = setup([]);
    sendMessage.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      accepted: true,
      pendingCount: 0,
      unresolvedCount: 1,
      unknownCount: 0,
      items: [{ alias: crypto.randomUUID(), headword: "franky", target: "franky" }],
      unknownBatches: [],
      nextCursorAlias: null,
    });
    const starting = controller.start();
    await controller.openReview();
    await flush();
    pending.finish({ accepted: false, batch: null });
    await starting;
    await flush();
    expect(
      document.querySelector("[data-huayi-backfill]")?.shadowRoot?.querySelector("input")?.value,
    ).toBe("franky");
  });

  it("does not recreate a banner when a stopped controller receives a late failure", async () => {
    let reject: (reason: unknown) => void = () => undefined;
    const { controller, sendMessage } = setup([]);
    sendMessage.mockReturnValueOnce(
      new Promise((_resolve, failed) => {
        reject = failed;
      }),
    );
    const starting = controller.start();
    await controller.activate();
    controller.stop();
    reject(new Error("disconnected"));
    await starting;
    await flush();
    expect(document.querySelector("[data-huayi-backfill]")).toBeNull();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it.each(["before submit", "while awaiting", "while recording"])(
    "preserves a user clearing the textarea %s",
    async (stage) => {
      const receipt = deferred();
      const input = textarea();
      const submit = button();
      const { controller } = setup([batch(["apple"]), batch(["water"], 200)], {
        resolve: () => receipt.promise,
      });
      await controller.start();
      if (stage !== "before submit") submit.click();
      if (stage === "while recording") {
        feedback("添加完成（1/1）");
        await flush();
      }
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (stage === "while awaiting") {
        feedback("添加完成（1/1）");
        await flush();
      }
      receipt.finish(accepted);
      document.body.append(document.createElement("span"));
      await flush();
      expect(input.value).toBe("");
    },
  );

  it("preserves a user's edit to a subset of the submitted words while waiting for feedback", async () => {
    const input = textarea();
    const submit = button();
    const { controller } = setup([batch(["apple", "pear"]), batch(["water"], 200)]);
    await controller.start();
    submit.click();
    input.value = "apple";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    feedback("添加完成（2/2）");
    await flush();
    expect(input.value).toBe("apple");
  });
  it("opens the upload dialog and prefills without clicking the final button", async () => {
    const upload = button("批量上传");
    const submit = button();
    const uploadClick = vi.spyOn(upload, "click");
    const finalClick = vi.spyOn(submit, "click");
    const { controller, sendMessage } = setup([batch(["apple"])]);
    await controller.start();
    expect(sendMessage).toHaveBeenCalledWith({ type: "store/backfill-page-ready" });
    expect(uploadClick).toHaveBeenCalledOnce();
    const input = textarea();
    await flush();
    expect(input.value).toBe("apple");
    expect(finalClick).not.toHaveBeenCalled();
  });

  it("requires a fresh modeled user click for each of 21 words split into 20 plus 1", async () => {
    const first = batch(firstWords);
    const second = batch(["water"], 200);
    const input = textarea();
    const submit = button();
    const finalClick = vi.spyOn(submit, "click");
    const { controller, messages } = setup([first, second]);
    await controller.start();
    expect(input.value.split("\n")).toEqual(firstWords);
    expect(finalClick).not.toHaveBeenCalled();

    submit.click();
    input.value = "";
    const firstResult = feedback("添加完成（20/20）");
    await flush();
    expect(messages("store/backfill-resolve")).toEqual([
      {
        type: "store/backfill-resolve",
        batchAlias: first.batchAlias,
        confirmedAliases: first.items.map((item) => item.alias),
        rejectedAliases: [],
      },
    ]);
    expect(input.value).toBe("water");
    expect(finalClick).toHaveBeenCalledTimes(1);
    expect(messages("store/backfill-page-ready")).toHaveLength(2);

    // Old feedback remains visible during the next batch's separate user gesture.
    submit.click();
    feedback("页面已刷新");
    await flush();
    expect(messages("store/backfill-resolve")).toHaveLength(1);
    firstResult.remove();
    input.value = "";
    feedback("添加完成（1/1）");
    await flush();
    expect(messages("store/backfill-resolve")[1]).toEqual({
      type: "store/backfill-resolve",
      batchAlias: second.batchAlias,
      confirmedAliases: second.items.map((item) => item.alias),
      rejectedAliases: [],
    });
    expect(messages("store/backfill-page-ready")).toHaveLength(3);
    expect(finalClick).toHaveBeenCalledTimes(2);
  });

  it("does not trust a synthetic click or forged success DOM by default", async () => {
    const input = textarea();
    const submit = button();
    const { controller, messages } = setup([batch(["apple"])], { trusted: false });
    await controller.start();
    expect(input.value).toBe("apple");
    submit.click();
    feedback();
    await flush();
    expect(messages("store/backfill-resolve")).toEqual([]);
    expect(messages("store/backfill-page-ready")).toHaveLength(1);
  });

  it("preserves manual text present before the first fill and refuses mismatched submission", async () => {
    const input = textarea("my own words");
    const submit = button();
    const { controller, messages } = setup([batch(["apple"])]);
    await controller.start();
    expect(input.value).toBe("my own words");
    submit.click();
    feedback();
    await flush();
    expect(input.value).toBe("my own words");
    expect(messages("store/backfill-resolve")).toEqual([]);
  });

  it("waits for durable acceptance before fetching another batch and preserves intervening edits", async () => {
    const receipt = deferred();
    const input = textarea();
    const submit = button();
    const { controller, messages } = setup([batch(["apple"]), batch(["water"], 200)], {
      resolve: () => receipt.promise,
    });
    await controller.start();
    submit.click();
    input.value = "";
    feedback();
    await flush();
    expect(messages("store/backfill-resolve")).toHaveLength(1);
    expect(messages("store/backfill-page-ready")).toHaveLength(1);
    input.value = "my next words";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    receipt.finish(accepted);
    await flush();
    expect(messages("store/backfill-page-ready")).toHaveLength(2);
    expect(input.value).toBe("my next words");
  });

  it.each(["network failure", "rejected receipt"])("does not advance after %s", async (failure) => {
    const input = textarea();
    const submit = button();
    const { controller, messages } = setup([batch(["apple"]), batch(["water"], 200)], {
      resolve: async () => {
        if (failure === "network failure") throw new Error("private transport details");
        return { accepted: false, batch: null };
      },
    });
    await controller.start();
    submit.click();
    feedback();
    await flush();
    feedback("页面已刷新");
    await flush();
    expect(messages("store/backfill-resolve")).toHaveLength(1);
    expect(messages("store/backfill-page-ready")).toHaveLength(1);
    expect(input.value).not.toBe("water");
    expect(document.body.textContent).not.toContain("private transport details");
  });

  it("maps explicit partial rejection to current aliases", async () => {
    const current = batch(["apple", "evidence"]);
    const input = textarea();
    const submit = button();
    const { controller, messages } = setup([current]);
    await controller.start();
    submit.click();
    input.value = "evidence";
    feedback("有1个单词未能成功添加", "alert");
    await flush();
    expect(messages("store/backfill-resolve")).toEqual([
      {
        type: "store/backfill-resolve",
        batchAlias: current.batchAlias,
        confirmedAliases: [current.items[0]?.alias],
        rejectedAliases: [current.items[1]?.alias],
      },
    ]);
    expect(input.value).toBe("evidence");
  });

  it("renews an idle batch every 60 seconds and cancels renewal when stopped", async () => {
    vi.useFakeTimers();
    const current = batch(["apple"]);
    textarea();
    const { controller, messages } = setup([current]);
    await controller.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(messages("store/backfill-renew")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(messages("store/backfill-renew")).toEqual([
      {
        type: "store/backfill-renew",
        batchAlias: current.batchAlias,
      },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(messages("store/backfill-renew")).toHaveLength(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(messages("store/backfill-renew")).toHaveLength(2);
    expect(messages("store/backfill-unknown")).toEqual([]);
  });

  it("marks missing results unknown after 30 seconds without claiming success", async () => {
    vi.useFakeTimers();
    const current = batch(["apple"]);
    textarea();
    const submit = button();
    const { controller, messages } = setup([current]);
    await controller.start();
    submit.click();
    feedback("正在处理");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(messages("store/backfill-unknown")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(messages("store/backfill-unknown")).toEqual([
      {
        type: "store/backfill-unknown",
        batchAlias: current.batchAlias,
      },
    ]);
    expect(messages("store/backfill-resolve")).toEqual([]);
  });

  it("reports unknown once when stopped after a click and ignores late page results", async () => {
    vi.useFakeTimers();
    const current = batch(["apple"]);
    textarea();
    const submit = button();
    const { controller, messages } = setup([current]);
    await controller.start();
    submit.click();
    controller.stop();
    controller.stop();
    feedback();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(messages("store/backfill-unknown")).toEqual([
      {
        type: "store/backfill-unknown",
        batchAlias: current.batchAlias,
      },
    ]);
    expect(messages("store/backfill-resolve")).toEqual([]);
    expect(messages("store/backfill-page-ready")).toHaveLength(1);
  });
});
