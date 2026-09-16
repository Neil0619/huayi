import { afterEach, vi } from "vitest";
import { BackfillReviewPanel } from "./backfill-review-panel.js";

export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected review control");
  return value;
}
export const sourceAlias = "00000000-0000-4000-8000-000000000001";
export const secondAlias = "00000000-0000-4000-8000-000000000004";
export const batchAlias = "00000000-0000-4000-8000-000000000002";
export const cursorAlias = "00000000-0000-4000-8000-000000000003";
export const data = () => ({
  accepted: true,
  pendingCount: 0,
  unresolvedCount: 52,
  unknownCount: 1,
  items: [
    {
      alias: sourceAlias,
      headword: "franky",
      target: "franky",
      explanation: "未找到可靠原形",
      candidates: [],
    },
    {
      alias: secondAlias,
      headword: "msg",
      target: "msg",
      explanation: "未找到可靠原形",
      candidates: [],
    },
  ],
  unknownBatches: [{ alias: batchAlias, headwords: ["apple"] }],
  nextCursorAlias: cursorAlias,
});
const panels: BackfillReviewPanel[] = [];
export function setup(trusted = true) {
  let update = 0;
  const sendMessage = vi.fn(async (message: unknown): Promise<unknown> => {
    const type = (message as { type: string }).type;
    if (type === "store/backfill-page-review") return data();
    return {
      accepted: true,
      update: ++update,
      pendingCount: type.endsWith("replace") ? 1 : 0,
      unresolvedCount: type.endsWith("discard-all") ? 0 : 51,
      unknownCount: type.endsWith("discard-all") ? 0 : 1,
    };
  });
  const confirm = vi.fn(() => true);
  const continueBackfill = vi.fn(async () => undefined);
  const panel = new BackfillReviewPanel({
    document,
    sendMessage,
    confirm,
    continueBackfill,
    ...(trusted ? { acceptsUserGesture: () => true } : {}),
  });
  panels.push(panel);
  const root = required(required(document.querySelector("[data-huayi-backfill]")).shadowRoot);
  const click = (label: string) =>
    required([...root.querySelectorAll("button")].find((b) => b.textContent === label)).click();
  return { panel, root, click, sendMessage, confirm, continueBackfill };
}
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
});
