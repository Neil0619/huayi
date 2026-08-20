import { expect, it } from "vitest";

import { parseWebEnvironment } from "./environment.js";

it("accepts the API origin without contacting it", () => {
  expect(parseWebEnvironment({ VITE_API_ORIGIN: "https://api.huayi.example" })).toEqual({
    VITE_API_ORIGIN: "https://api.huayi.example",
  });
});
