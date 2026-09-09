import { expect, it, vi } from "vitest";
import type { StudyCaptureDetailResponse } from "@huayi/cloud-contracts";
import { saveCaptureDraft, type SavedCapture } from "./capture-save";
import { createStore, deferred } from "../components/draft-test-support";

it.each([
  { text: "New text" },
  { kind: "phrase" },
  { title: "New title" },
  { context: "New context" },
  { text: "Remember this. " },
])("keeps a newer collect draft while the old save resolves: %j", async (change) => {
  const capture = { id: "capture", revision: 1 } as SavedCapture["capture"];
  const response = deferred<SavedCapture>();
  const api = {
    createCapture: () => response.promise,
    capture: async () => ({ capture }) as StudyCaptureDetailResponse,
    patchCapture: async () => ({ capture, latestAnalysis: null, activeAnalysisRequest: null }),
  };
  const store = createStore();
  const initial = { text: "Remember this.", kind: "sentence" as const, title: "", context: "" };
  store.set("collect-draft", initial);
  const saving = saveCaptureDraft(api, store, { ...initial, sourceText: initial.text });
  const edited = { ...initial, ...change };
  store.set("collect-draft", edited);
  response.resolve({
    capture,
    outcome: "created",
    undo: { captureId: capture.id, expectedRevision: 1 },
  });
  await saving;
  expect(store.get("collect-draft")).toEqual(edited);
  expect(store.get("collect-created")).toBeUndefined();
});

it("clears an unchanged collect snapshot only after metadata is saved", async () => {
  const capture = { id: "capture", revision: 1 } as SavedCapture["capture"];
  const response = deferred<StudyCaptureDetailResponse>();
  const api = {
    createCapture: async () => ({
      capture,
      outcome: "created" as const,
      undo: { captureId: capture.id, expectedRevision: 1 },
    }),
    capture: async () => ({ capture }) as StudyCaptureDetailResponse,
    patchCapture: () => response.promise,
  };
  const store = createStore();
  const initial = {
    text: "Remember this.",
    kind: "sentence" as const,
    title: " title ",
    context: " context ",
  };
  store.set("collect-draft", initial);
  const saving = saveCaptureDraft(api, store, { ...initial, sourceText: initial.text });
  await Promise.resolve();
  expect(store.get("collect-draft")).toEqual(initial);
  response.resolve({ capture, latestAnalysis: null, activeAnalysisRequest: null });
  await saving;
  expect(store.get("collect-draft")).toBeUndefined();
});
it("resumes the saved capture after metadata fails without collecting it a second time", async () => {
  const capture = { id: "capture", revision: 1 } as SavedCapture["capture"];
  const createCapture = vi.fn(async () => ({
    outcome: "created" as const,
    capture,
    undo: { captureId: capture.id, expectedRevision: 1 },
  }));
  const patchCapture = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ capture: { ...capture, revision: 2 } });
  const api = {
    createCapture,
    patchCapture,
    capture: async () => ({ capture }) as StudyCaptureDetailResponse,
  };
  const values = new Map<string, unknown>();
  const store = {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
  };
  const input = {
    sourceText: "Remember this.",
    kind: "sentence" as const,
    title: "Context",
    context: "",
  };
  await expect(saveCaptureDraft(api, store, input)).rejects.toThrow("offline");
  expect((await saveCaptureDraft(api, store, input)).revision).toBe(2);
  expect(createCapture).toHaveBeenCalledOnce();
  expect(patchCapture).toHaveBeenCalledTimes(2);
});
