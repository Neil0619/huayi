import type { AnalyzeRequest, HostEvent } from "@huayi/protocol";

import { createCollocationsEvent, createResultEvent } from "./harness-results.js";

const CONTROLLED_STREAM_WORD = "controlledstream";

export function installControlledStreamHarness(
  documentRef: Document,
  emit: (event: HostEvent) => void,
): (request: AnalyzeRequest) => boolean {
  let request: AnalyzeRequest | null = null;
  let stage = 0;

  const emitStage = (nextStage: 1 | 2 | 3): void => {
    if (request === null || nextStage !== stage + 1) {
      return;
    }
    stage = nextStage;
    if (nextStage < 3) {
      const event = createCollocationsEvent(request, nextStage + 2, nextStage);
      if (event !== null) {
        emit(event);
      }
      return;
    }
    emit(createResultEvent(request));
    request = null;
  };

  documentRef.addEventListener("huayi-e2e-stream-first", () => emitStage(1));
  documentRef.addEventListener("huayi-e2e-stream-second", () => emitStage(2));
  documentRef.addEventListener("huayi-e2e-stream-final", () => emitStage(3));

  return (candidate): boolean => {
    if (candidate.selection !== CONTROLLED_STREAM_WORD) {
      return false;
    }
    request = candidate;
    stage = 0;
    return true;
  };
}
