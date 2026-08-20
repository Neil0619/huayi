import type { SubmissionOutboxInput } from "./submission-outbox-vault.js";
import type { CloudStudyCaptureApi } from "./cloud-study-capture-api.js";
import type { CloudWordCopyApi } from "./cloud-word-copy-api.js";

export function createCloudSubmissionApi(options: {
  studyCaptures: Pick<CloudStudyCaptureApi, "submit">;
  wordCopies: Pick<CloudWordCopyApi, "copy">;
}) {
  return {
    async submit(input: SubmissionOutboxInput, key: string, sessionToken: string) {
      if (input.type === "study-capture") {
        return {
          response: await options.studyCaptures.submit(input.payload, key, sessionToken),
          type: "study-capture" as const,
        };
      }
      return {
        response: await options.wordCopies.copy(input.payload, key, sessionToken),
        type: "cloud-word-copy" as const,
      };
    },
  };
}
