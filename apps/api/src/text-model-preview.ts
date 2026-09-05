import { StreamingJsonTokenizer } from "@huayi/cloud-contracts";
import type { ModelExecution } from "./model-execution.js";

export function createTextModelPreview(fields: ReadonlySet<string>, execution: ModelExecution) {
  const parser = new StreamingJsonTokenizer();
  let invalid = false,
    sequence = 0,
    characters = 0;
  return (chunk: string): void => {
    if (invalid) return;
    try {
      for (const update of parser.push(chunk)) {
        if (update.kind !== "string-delta" || !fields.has(update.field)) continue;
        characters += update.value.length;
        if (characters > 16_000) continue;
        for (let offset = 0; offset < update.value.length;) {
          const text = Array.from(update.value.slice(offset)).slice(0, 2_000).join("");
          if (sequence === 0) execution.onTiming?.("first-display-field");
          execution.onPreview?.({ section: update.field, sequence: sequence++, text });
          offset += text.length;
        }
      }
    } catch {
      invalid = true;
    }
  };
}
