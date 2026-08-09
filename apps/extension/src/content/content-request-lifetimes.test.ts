import { describe, expect, it } from "vitest";

import { ContentRequestLifetimes } from "./content-request-lifetimes.js";

describe("ContentRequestLifetimes", () => {
  it("closes view-bound lanes while detaching an accepted add", () => {
    const lifetimes = new ContentRequestLifetimes();
    lifetimes.begin("analysis-1", "analysis");
    lifetimes.begin("check-1", "wordbook-check");
    lifetimes.begin("add-1", "wordbook-add");

    expect(lifetimes.closeView()).toEqual(["analysis-1", "check-1"]);
    expect(lifetimes.get("analysis-1")).toBeUndefined();
    expect(lifetimes.get("check-1")).toBeUndefined();
    expect(lifetimes.get("add-1")).toMatchObject({
      attachedToView: false,
      operation: "wordbook-add",
    });
  });

  it("keeps detached adds until their terminal event and cancels them on destruction", () => {
    const lifetimes = new ContentRequestLifetimes();
    lifetimes.begin("completed-add", "wordbook-add");
    lifetimes.closeView();

    expect(lifetimes.complete("completed-add")).toMatchObject({
      attachedToView: false,
      operation: "wordbook-add",
    });
    expect(lifetimes.complete("completed-add")).toBeUndefined();

    lifetimes.begin("destroyed-add", "wordbook-add");
    expect(lifetimes.cancelAll()).toEqual(["destroyed-add"]);
    expect(lifetimes.get("destroyed-add")).toBeUndefined();
  });
});
