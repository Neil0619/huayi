import { afterEach, vi } from "vitest";

import { backfillMessageSchema, type BackfillPageBatch } from "../../backfill/backfill-messages.js";
import { BackfillPageController } from "./backfill-page-controller.js";

const controllers: BackfillPageController[] = [];
export const accepted = { accepted: true, batch: null };
export const firstWords = [
  "apple",
  "book",
  "cat",
  "dog",
  "evidence",
  "forest",
  "garden",
  "house",
  "island",
  "journey",
  "kind",
  "light",
  "moon",
  "night",
  "ocean",
  "paper",
  "quiet",
  "river",
  "stone",
  "tree",
];

export function batch(words: string[], offset = 0): BackfillPageBatch {
  const alias = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    batchAlias: alias(offset + 100),
    items: words.map((headword, index) => ({ alias: alias(offset + index + 1), headword })),
  };
}

export function button(text = "批量添加"): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;
  document.body.append(element);
  return element;
}

export function textarea(value = ""): HTMLTextAreaElement {
  const element = document.createElement("textarea");
  element.placeholder = "请输入需要添加的单词，每行一个";
  element.value = value;
  document.body.append(element);
  return element;
}

export function feedback(text = "添加成功", role = "status"): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("role", role);
  element.textContent = text;
  document.body.append(element);
  return element;
}

export async function flush(): Promise<void> {
  // Let MutationObserver delivery and chained background replies finish without advancing time.
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

export function deferred() {
  let finish: (value: unknown) => void = () => {
    throw new Error("Promise not initialized");
  };
  const promise = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  return { finish, promise };
}

export function setup(
  batches: BackfillPageBatch[],
  options: { resolve?: () => Promise<unknown>; trusted?: boolean } = {},
) {
  const requests: ReturnType<typeof backfillMessageSchema.parse>[] = [];
  let nextBatch = 0;
  const sendMessage = vi.fn(async (message: unknown): Promise<unknown> => {
    const request = backfillMessageSchema.parse(message);
    requests.push(request);
    if (request.type === "store/backfill-page-ready") {
      return { accepted: true, batch: batches[nextBatch++] ?? null };
    }
    if (request.type === "store/backfill-resolve" && options.resolve) return options.resolve();
    return accepted;
  });
  // jsdom cannot create isTrusted events; opt in only for tests modeling a person's click.
  const controller = new BackfillPageController({
    document,
    sendMessage,
    ...(options.trusted === false ? {} : { acceptsUserGesture: () => true }),
  });
  controllers.push(controller);
  const messages = (type: string) => requests.filter((request) => request.type === type);
  return { controller, messages, sendMessage };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
