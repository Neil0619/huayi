import { contractFixtures, startAnalysisRequestSchema } from "@huayi/cloud-contracts";
import { expect, it } from "vitest";

it("constructs the shared analysis fixture through the public Cloud contract", () => {
  expect(startAnalysisRequestSchema.parse(contractFixtures.startAnalysisRequest)).toEqual(
    contractFixtures.startAnalysisRequest,
  );
});
