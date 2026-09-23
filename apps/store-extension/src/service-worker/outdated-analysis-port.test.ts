import { describe, expect, it, vi } from "vitest";
import { STORE_ANALYSIS_PORT_NAME } from "@huayi/store-domain";

import { rejectOutdatedAnalysisPort } from "./outdated-analysis-port.js";

function port(name: string) {
  let receive: (value: unknown) => void = () => undefined;
  return {
    name,
    postMessage: vi.fn(),
    onMessage: {
      addListener: (listener: typeof receive) => {
        receive = listener;
      },
    },
    send: (value: unknown) => receive(value),
  };
}
describe("outdated Store analysis connections", () => {
  it("gives an already open v5 tab a refresh error without accepting analysis", () => {
    const old = port("huayi-store-analysis-v5");
    expect(rejectOutdatedAnalysisPort(old)).toBe(true);
    old.send({
      get selection() {
        throw new Error("Old body must never be read");
      },
    });
    expect(old.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "store/analysis-error",
      code: "version-mismatch",
      requestId: null,
      messageVersion: 5,
    });
    old.send({});
    expect(old.postMessage).toHaveBeenCalledOnce();
  });
  it.each([
    STORE_ANALYSIS_PORT_NAME,
    "foreign",
    "huayi-store-analysis-v999",
    "huayi-store-analysis-v05",
  ])("does not consume %s", (name) => {
    const value = port(name);
    expect(rejectOutdatedAnalysisPort(value)).toBe(false);
    value.send({});
    expect(value.postMessage).not.toHaveBeenCalled();
  });
});
