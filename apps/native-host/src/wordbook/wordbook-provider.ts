import type { AddWordRequest, WordbookAddOutcome } from "@huayi/protocol";

export interface WordbookProvider {
  addWord(request: AddWordRequest, signal: AbortSignal): Promise<WordbookAddOutcome>;
}
