import { afterEach, expect, it } from "vitest";
import { backfillStatus, discoverBackfill } from "@huayi/store-domain";
import { createBackfillAuthority } from "../../backfill/backfill-authority.js";
import { createBackfillRuntime } from "../../backfill/backfill-runtime.js";
import { initialBackfillStorage } from "../../backfill/backfill-vault.js";
import { BackfillPageController } from "./backfill-page-controller.js";

// Public Shanbay bundle main.eaabd3cf.chunk.js, inspected 2026-09-15:
// the upload and submit controls and inline result are divs without ARIA roles.
const actualDialog = `
  <div class="index_container__37q1F">
    <div class="index_title__3D8B1">批量添加到生词本</div>
    <textarea placeholder="在这里输入需要添加的单词。多个单词以回车键换行区分。"></textarea>
    <div class="index_counter__3Dkby"></div>
    <div class="index_submit__1wWYx">批量添加</div>
  </div>`;
const controllers: BackfillPageController[] = [];
async function flush() {
  for (let index = 0; index < 100; index += 1) await Promise.resolve();
}
function input(): HTMLTextAreaElement {
  const element = document.querySelector("textarea");
  if (!element) throw new Error("Missing batch input");
  return element;
}
function submit(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".index_submit__1wWYx");
  if (!element) throw new Error("Missing batch submit control");
  return element;
}
function result(text: string, role?: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "index_msg__3o1cu";
  element.textContent = text;
  if (role) element.setAttribute("role", role);
  input().parentElement?.insertBefore(element, submit());
  return element;
}
async function setup(words: string[]) {
  const state = initialBackfillStorage();
  state.localEnabled = true;
  discoverBackfill(state.local, words, "eudic", new Date().toISOString());
  const authority = createBackfillAuthority({
    vault: { read: async () => state, write: async () => undefined },
    session: { readSession: async () => null },
    api: null,
    lock: async (work) => work(),
  });
  const badges: string[] = [];
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    discovery: {
      lexicon: { snapshot: async () => [] },
      eudic: { listWords: async () => [] },
      allowEudic: async () => false,
    },
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab: async () => 7,
    activateTab: async () => undefined,
    setBadge: async (text) => {
      badges.push(text);
    },
    scheduleMore: () => undefined,
  });
  await runtime.handle(
    { type: "store/backfill-open", expectedScope: "local" },
    { id: "extension", url: "chrome-extension://extension/popup.html" },
  );
  const controller = new BackfillPageController({
    document,
    // jsdom cannot generate trusted events; the browser regression uses real clicks.
    acceptsUserGesture: () => true,
    sendMessage: (message) =>
      runtime.handle(message, {
        id: "extension",
        tab: { id: 7 },
        documentId: "document",
        frameId: 0,
        url: "https://web.shanbay.com/wordsweb/#/collection",
      }),
  });
  controllers.push(controller);
  await controller.start();
  return { state, controller, badges };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  document.body.replaceChildren();
});

it("recognizes the actual div submit and inline result, persists the receipt and clears the badge", async () => {
  document.body.innerHTML = actualDialog;
  const h = await setup(["devastating"]);
  expect(input().value).toBe("devastating");
  submit().click();
  input().value = "";
  result("添加完成（1/1）");
  await flush();
  expect(backfillStatus(h.state.local)).toMatchObject({
    pendingCount: 0,
    unknownCount: 0,
    unresolvedCount: 0,
  });
  expect(h.state.local.targets["devastating"]?.confirmedAt).not.toBeNull();
  expect(h.badges.at(-1)).toBe("");
});

it("recognizes inline count completion independently of the submit control markup", async () => {
  document.body.innerHTML = actualDialog;
  submit().setAttribute("role", "button");
  const h = await setup(["apple"]);
  submit().click();
  input().value = "";
  result("添加完成（1/1）");
  await flush();
  expect(backfillStatus(h.state.local).pendingCount).toBe(0);
});

it("opens the actual div upload launcher without submitting the words", async () => {
  document.body.innerHTML =
    '<div class="Collection_content"><div class="Collection_batchUploadBtn__fixture">批量上传</div></div>';
  const upload = document.querySelector<HTMLElement>(".Collection_batchUploadBtn__fixture");
  if (!upload) throw new Error("Missing upload launcher");
  upload.addEventListener("click", () => {
    document.body.insertAdjacentHTML("beforeend", actualDialog);
  });
  const h = await setup(["apple"]);
  await flush();
  expect(document.querySelector("textarea")?.value).toBe("apple");
  expect(backfillStatus(h.state.local).pendingCount).toBe(1);
});

it("accepts new identical completion messages for two separate 100-word user submissions", async () => {
  document.body.innerHTML = actualDialog;
  submit().setAttribute("role", "button");
  const words = Array.from(
    { length: 200 },
    (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
  );
  const h = await setup(words);
  submit().click();
  input().value = "";
  const oldResult = result("添加完成（100/100）", "status");
  await flush();
  expect(backfillStatus(h.state.local).pendingCount).toBe(100);
  expect(input().value.split("\n")).toHaveLength(100);
  // The prior result is still present at click. Only the new result may confirm this batch.
  submit().click();
  await flush();
  expect(backfillStatus(h.state.local).pendingCount).toBe(100);
  oldResult.remove();
  input().value = "";
  result("添加完成（100/100）", "status");
  await flush();
  expect(backfillStatus(h.state.local)).toMatchObject({ pendingCount: 0, unknownCount: 0 });
  expect(h.badges.at(-1)).toBe("");
});

it("notifies a framework-controlled input through its native value setter", async () => {
  document.body.innerHTML = actualDialog;
  const element = input();
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (!descriptor?.get || !descriptor.set) throw new Error("Missing native textarea descriptor");
  let tracked = "";
  let frameworkValue = "";
  Object.defineProperty(element, "value", {
    configurable: true,
    get: () => descriptor.get?.call(element) as string,
    set: (value: string) => {
      tracked = value;
      descriptor.set?.call(element, value);
    },
  });
  element.addEventListener("input", () => {
    if (tracked !== element.value) {
      frameworkValue = element.value;
      tracked = element.value;
    }
  });
  await setup(["apple"]);
  expect(element.value).toBe("apple");
  expect(frameworkValue).toBe("apple");
});
