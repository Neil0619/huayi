import type {
  AddWordRequest,
  CheckWordRequest,
  WordbookAddOutcome,
  WordbookPresence,
} from "@huayi/protocol";

export interface WordbookProvider {
  addWord(request: AddWordRequest, signal: AbortSignal): Promise<WordbookAddOutcome>;
  checkWord(request: CheckWordRequest, signal: AbortSignal): Promise<WordbookPresence>;
}
