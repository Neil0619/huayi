import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("tells JSON-output providers to merge meanings that share a part of speech", () => {
  const path = fileURLToPath(new URL("./schemas/translate-word.json", import.meta.url));
  const source = readFileSync(path, "utf8");

  expect(source).toMatch(/one group per partOfSpeech/iu);
  expect(source).toMatch(/merge/iu);
});

it("requires each meaning group to emit partOfSpeech before meaningsZh without omissions", () => {
  const path = fileURLToPath(new URL("./schemas/translate-word.json", import.meta.url));
  const source = readFileSync(path, "utf8");
  const schema = JSON.parse(source) as {
    properties: {
      commonMeanings: {
        description: string;
        items: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
    };
  };
  const commonMeanings = schema.properties.commonMeanings;

  expect(Object.keys(commonMeanings.items.properties)).toEqual(["partOfSpeech", "meaningsZh"]);
  expect(commonMeanings.items.required).toEqual(["partOfSpeech", "meaningsZh"]);
  expect(commonMeanings.description).toMatch(/exactly two keys.*partOfSpeech.*meaningsZh/iu);
  expect(commonMeanings.description).toMatch(/never omit/iu);
});
