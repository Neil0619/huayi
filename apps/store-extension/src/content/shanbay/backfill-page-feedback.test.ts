import { afterEach, expect, it } from "vitest";
import { BackfillPageController } from "./backfill-page-controller.js";

const controllers: BackfillPageController[] = [];
const current = {
  batchAlias: "00000000-0000-4000-8000-000000000100",
  items: [
    { alias: "00000000-0000-4000-8000-000000000001", headword: "apple" },
    { alias: "00000000-0000-4000-8000-000000000002", headword: "pear" },
  ],
};
async function flush() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}
async function setup() {
  document.body.innerHTML = `<div role="dialog">
    <h2>批量添加到生词本</h2>
    <textarea placeholder="需要添加的单词"></textarea>
    <div class="index_submit__1wWYx"><span>批量添加</span></div>
  </div>`;
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const input = document.querySelector("textarea");
  const submit = document.querySelector<HTMLElement>(".index_submit__1wWYx");
  if (!dialog || !input || !submit) throw new Error("Missing fixture controls");
  const requests: unknown[] = [];
  const controller = new BackfillPageController({
    document,
    acceptsUserGesture: () => true,
    sendMessage: async (message) => {
      requests.push(message);
      return { accepted: true, batch: requests.length === 1 ? current : null };
    },
  });
  controllers.push(controller);
  await controller.start();
  const feedback = (text: string, parent: HTMLElement = dialog) => {
    const node = document.createElement("div");
    node.className = "index_msg__3o1cu";
    node.textContent = text;
    parent.append(node);
    return node;
  };
  const resolved = () =>
    requests.filter((item) => JSON.stringify(item).includes('"store/backfill-resolve"'));
  return { controller, dialog, input, submit, feedback, resolved };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  document.body.replaceChildren();
});

it("uses the actual fresh inline warning and exact failed word list for a nested div click", async () => {
  const h = await setup();
  h.submit.querySelector("span")?.click();
  h.input.value = "pear";
  h.feedback("有1个单词未能成功添加").classList.add("index_warning__1oqS0");
  await flush();
  expect(h.resolved()).toEqual([
    {
      type: "store/backfill-resolve",
      batchAlias: current.batchAlias,
      confirmedAliases: [current.items[0]?.alias],
      rejectedAliases: [current.items[1]?.alias],
    },
  ]);
  expect(h.input.value).toBe("pear");
});

it.each(["pear\npear", "unknown", "apple\npear", ""])(
  "does not confirm an invalid rejected list: %s",
  async (value) => {
    const h = await setup();
    h.submit.click();
    h.input.value = value;
    h.feedback("有1个单词未能成功添加");
    await flush();
    expect(h.resolved()).toEqual([]);
  },
);

it("does not combine a stale partial count with a fresh unrelated failure", async () => {
  const h = await setup();
  h.feedback("有1个单词未能成功添加");
  h.submit.click();
  h.input.value = "pear";
  const node = h.feedback("网络失败，请稍后重试");
  node.setAttribute("role", "alert");
  await flush();
  expect(h.resolved()).toEqual([]);
});

it.each(["aria", "actual"])(
  "ignores results outside the submitted dialog, including a second %s dialog",
  async (kind) => {
    const h = await setup();
    h.submit.click();
    h.feedback("添加完成（2/2）", document.body).setAttribute("role", "status");
    const other = document.createElement("div");
    if (kind === "aria") other.setAttribute("role", "dialog");
    else other.className = "index_container__37q1F";
    h.dialog.append(other);
    h.feedback("添加完成（2/2）", other);
    await flush();
    expect(h.resolved()).toEqual([]);
  },
);

it("does not treat a stale inline result or the extension's own banner as a receipt", async () => {
  const h = await setup();
  h.feedback("添加完成（2/2）");
  h.submit.click();
  const own = h.feedback("添加完成（2/2）");
  own.dataset.huayiBackfill = "";
  await flush();
  expect(h.resolved()).toEqual([]);
});

it("does not confirm ambiguous or contradictory fresh results", async () => {
  const h = await setup();
  h.submit.click();
  h.feedback("添加完成（2/2）");
  h.feedback("有1个单词未能成功添加");
  h.input.value = "pear";
  await flush();
  expect(h.resolved()).toEqual([]);
});

it.each(["index_disabled__3qVue", "aria", "hidden", "duplicate"])(
  "does not arm an unusable or ambiguous submit control: %s",
  async (state) => {
    const h = await setup();
    if (state === "aria") h.submit.setAttribute("aria-disabled", "true");
    else if (state === "hidden") h.dialog.style.display = "none";
    else if (state === "duplicate") h.dialog.append(h.submit.cloneNode(true));
    else h.submit.classList.add(state);
    h.submit.querySelector("span")?.click();
    h.feedback("添加完成（2/2）");
    await flush();
    expect(h.resolved()).toEqual([]);
  },
);

it("accepts only the unique submit from the input's own dialog", async () => {
  const h = await setup();
  const other = document.createElement("button");
  other.textContent = "批量添加";
  document.body.append(other);
  other.click();
  const stale = h.feedback("添加完成（2/2）");
  await flush();
  expect(h.resolved()).toEqual([]);
  h.submit.click();
  stale.remove();
  h.feedback("添加完成（2/2）");
  await flush();
  expect(h.resolved()).toHaveLength(1);
});

it("does not attribute a failure list to the page after a user edited it", async () => {
  const h = await setup();
  h.submit.click();
  h.input.value = "pear";
  h.input.dispatchEvent(new Event("input", { bubbles: true }));
  h.feedback("有1个单词未能成功添加");
  await flush();
  expect(h.resolved()).toEqual([]);
});

it.each(["index_warning__1oqS0", "error", "failure"])(
  "does not read success text from an error result: %s",
  async (className) => {
    const h = await setup();
    h.submit.click();
    h.feedback("添加完成（2/2）").classList.add(className);
    await flush();
    expect(h.resolved()).toEqual([]);
  },
);

it("accepts a reused result node only after an observed Pending transition", async () => {
  const h = await setup();
  const node = h.feedback("添加完成（2/2）");
  h.submit.click();
  node.hidden = true;
  await flush();
  node.hidden = false;
  await flush();
  expect(h.resolved()).toEqual([]);
  node.textContent = "正在添加";
  await flush();
  node.textContent = "添加完成（2/2）";
  await flush();
  expect(h.resolved()).toHaveLength(1);
});
