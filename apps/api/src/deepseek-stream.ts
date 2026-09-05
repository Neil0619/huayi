import { z } from "zod/v3";
import type { ModelUsage } from "@huayi/cloud-contracts";
import { DeepSeekAnalysisModelError } from "./deepseek-provider-error.js";
import { parseDeepSeekUsage } from "./deepseek-provider-usage.js";

const eventSchema = z.object({
  id: z.string().min(1).max(256),
  model: z.literal("deepseek-v4-flash"),
  created: z.number().int().optional(),
  choices: z
    .array(
      z.strictObject({
        index: z.literal(0),
        logprobs: z.unknown().optional(),
        delta: z.strictObject({
          role: z.literal("assistant").optional(),
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          tool_calls: z.array(z.unknown()).max(0).optional(),
        }),
        finish_reason: z.string().nullable(),
      }),
    )
    .max(1),
  usage: z.unknown().optional(),
});

/** Bounds both wire bytes and buffered frames. Reasoning is discarded inside this boundary. */
export async function readDeepSeekStream(
  response: Pick<Response, "body">,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onToken: () => void = () => undefined,
): Promise<{ content: string; usage: ModelUsage }> {
  if (!response.body) throw new DeepSeekAnalysisModelError("model_response_invalid");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    pending = "",
    content = "",
    data: string[] = [];
  let id: string | undefined, created: number | undefined, finish: string | undefined;
  let usage: ModelUsage | undefined,
    done = false;
  let rejectAbort: (error: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () =>
    rejectAbort(new DeepSeekAnalysisModelError("model_timeout", undefined, usage));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  function frame(): void {
    if (data.length === 0) return;
    if (done) throw new DeepSeekAnalysisModelError("model_response_invalid");
    const raw = data.join("\n");
    data = [];
    if (raw === "[DONE]") {
      done = true;
      return;
    }
    const event = eventSchema.parse(JSON.parse(raw));
    if (
      (id !== undefined && event.id !== id) ||
      (created !== undefined && event.created !== created)
    ) {
      throw new DeepSeekAnalysisModelError("model_response_invalid");
    }
    id = event.id;
    created = event.created;
    if (event.usage !== null && event.usage !== undefined) usage = parseDeepSeekUsage(event.usage);
    const choice = event.choices[0];
    if (!choice) return;
    if (finish !== undefined) throw new DeepSeekAnalysisModelError("model_response_invalid");
    if (choice.delta.content || choice.delta.reasoning_content) onToken();
    if (choice.delta.content) {
      content += choice.delta.content;
      onDelta(choice.delta.content);
    }
    if (choice.finish_reason !== null) finish = choice.finish_reason;
  }
  function consume(flush = false): void {
    for (;;) {
      const ending = pending.search(/[\r\n]/u);
      if (ending < 0 || (!flush && pending[ending] === "\r" && ending === pending.length - 1))
        break;
      const line = pending.slice(0, ending);
      pending = pending.slice(ending + (pending.slice(ending, ending + 2) === "\r\n" ? 2 : 1));
      if (line === "") frame();
      else if (line.startsWith("data:")) data.push(line.slice(line[5] === " " ? 6 : 5));
      else if (!line.startsWith(":"))
        throw new DeepSeekAnalysisModelError("model_response_invalid");
    }
    if (pending.length > 65_536 || data.join("").length > 65_536)
      throw new DeepSeekAnalysisModelError("model_response_invalid");
  }
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new DeepSeekAnalysisModelError("model_response_invalid");
      pending += decoder.decode(chunk.value, { stream: true });
      consume();
    }
    pending += decoder.decode();
    consume(true);
    if (
      !done ||
      !id ||
      !usage ||
      content === "" ||
      pending.trim() !== "" ||
      data.length > 0 ||
      !finish
    ) {
      throw new DeepSeekAnalysisModelError("model_response_invalid", undefined, usage);
    }
    if (finish !== "stop")
      throw new DeepSeekAnalysisModelError("model_output_invalid", undefined, usage);
    return { content, usage };
  } catch (error) {
    if (error instanceof DeepSeekAnalysisModelError)
      throw error.usage || !usage
        ? error
        : new DeepSeekAnalysisModelError(error.code, undefined, usage);
    throw new DeepSeekAnalysisModelError("model_response_invalid", undefined, usage);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      /* A cancelled read may still be settling. */
    }
  }
}
