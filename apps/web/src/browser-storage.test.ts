import { afterEach, expect, it } from "vitest";

afterEach(() => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
});

it("uses browser Storage objects for persistence and same-storage events", () => {
  expect(window.localStorage).toBeInstanceOf(Storage);
  expect(window.sessionStorage).toBeInstanceOf(Storage);
  localStorage.setItem("appearance", "silver");
  sessionStorage.setItem("draft", "practice");
  expect(sessionStorage.getItem("appearance")).toBeNull();
  expect(localStorage.getItem("draft")).toBeNull();
  const event = new StorageEvent("storage", { storageArea: localStorage });
  expect(event.storageArea).toBe(localStorage);
  expect(window.localStorage.getItem("appearance")).toBe("silver");
});
