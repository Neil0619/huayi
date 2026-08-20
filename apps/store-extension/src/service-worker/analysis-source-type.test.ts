import { describe, expect, it } from "vitest";

import { analysisSourceTypeFromSenderUrl } from "./analysis-source-type.js";

describe("trusted BYOK source type", () => {
  it("uses only the privileged port sender URL to identify YouTube watch captions", () => {
    expect(analysisSourceTypeFromSenderUrl("https://www.youtube.com/watch?v=trusted")).toBe(
      "youtube-caption",
    );
    expect(analysisSourceTypeFromSenderUrl("https://www.youtube.com/results?q=words")).toBe(
      "web-selection",
    );
    expect(analysisSourceTypeFromSenderUrl("https://attacker.test/watch?v=trusted")).toBe(
      "web-selection",
    );
  });
});
