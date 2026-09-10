import { DEEPSEEK_PLATFORM_MODEL } from "./deepseek-model-identity.js";
import { captureDiagnostic } from "./diagnostic-context.js";
import { z } from "zod/v3";
import type { ModelUsage } from "@huayi/cloud-contracts";
import { DeepSeekAnalysisModelError } from "./deepseek-provider-error.js";
import { parseDeepSeekUsage } from "./deepseek-provider-usage.js";

type StreamFailureStage =
  | "missing-body"
  | "read"
  | "utf8"
  | "wire-limit"
  | "content-limit"
  | "frame-limit"
  | "sse-line"
  | "frame-json"
  | "frame-schema"
  | "stream-identity"
  | "usage"
  | "after-done"
  | "after-finish"
  | "missing-done"
  | "missing-identity"
  | "missing-usage"
  | "pending-terminal"
  | "unterminated-frame"
  | "missing-finish"
  | "empty-content"
  | "token-limit-empty-content"
  | "token-limit-with-content"
  | "non-stop-finish";

type StreamDiagnosticSink = (diagnostic: {
  event: "deepseek_stream_failed";
  stage: StreamFailureStage;
}) => void;

// SSE repeats the response envelope for each token, including discarded reasoning.
// Give transport overhead its own bound; retained answer text stays independently limited.
const MAXIMUM_WIRE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_CONTENT_CHARACTERS = 1024 * 1024;
const MAXIMUM_FRAME_CHARACTERS = 65_536;

const eventSchema = z.object({
  id: z.string().min(1).max(256),
  model: z.literal(DEEPSEEK_PLATFORM_MODEL),
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
  diagnosticSink: StreamDiagnosticSink = (diagnostic) => console.warn(diagnostic),
): Promise<{ content: string; usage: ModelUsage }> {
  // Stages are source literals only; never inspect errors or untrusted model fields for logs.
  function warn(stage: StreamFailureStage): void {
    if (signal.aborted) return;
    try {
      captureDiagnostic({
        code: "model_response_invalid",
        stage,
        provider: "deepseek",
        severity: "warn",
      });
      diagnosticSink({ event: "deepseek_stream_failed", stage });
    } catch {
      /* Diagnostics must not change stream results or billing receipts. */
    }
  }
  if (!response.body) {
    warn("missing-body");
    throw new DeepSeekAnalysisModelError("model_response_invalid");
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    warn("read");
    throw error;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    pending = "",
    content = "",
    data: string[] = [];
  let id: string | undefined, created: number | undefined, finish: string | undefined;
  let usage: ModelUsage | undefined,
    done = false;
  let stage: StreamFailureStage | undefined;
  let dataCharacters = 0;
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
    stage = "after-done";
    if (done) throw new DeepSeekAnalysisModelError("model_response_invalid");
    const raw = data.join("\n");
    data = [];
    dataCharacters = 0;
    if (raw === "[DONE]") {
      done = true;
      return;
    }
    stage = "frame-json";
    const parsed: unknown = JSON.parse(raw);
    stage = "frame-schema";
    const event = eventSchema.parse(parsed);
    stage = "stream-identity";
    if (
      (id !== undefined && event.id !== id) ||
      (created !== undefined && event.created !== created)
    ) {
      throw new DeepSeekAnalysisModelError("model_response_invalid");
    }
    id = event.id;
    created = event.created;
    stage = "usage";
    if (event.usage !== null && event.usage !== undefined) usage = parseDeepSeekUsage(event.usage);
    const choice = event.choices[0];
    if (!choice) return;
    stage = "after-finish";
    if (finish !== undefined) throw new DeepSeekAnalysisModelError("model_response_invalid");
    // Consumer callback failures are not provider parse/read failures.
    stage = undefined;
    if (choice.delta.content || choice.delta.reasoning_content) onToken();
    if (choice.delta.content) {
      stage = "content-limit";
      if (content.length + choice.delta.content.length > MAXIMUM_CONTENT_CHARACTERS)
        throw new DeepSeekAnalysisModelError("model_response_invalid");
      content += choice.delta.content;
      stage = undefined;
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
      stage = "frame-limit";
      if (line.length > MAXIMUM_FRAME_CHARACTERS)
        throw new DeepSeekAnalysisModelError("model_response_invalid");
      stage = "sse-line";
      if (line === "") frame();
      else if (line.startsWith("data:")) {
        const value = line.slice(line[5] === " " ? 6 : 5);
        dataCharacters += value.length + (data.length > 0 ? 1 : 0);
        stage = "frame-limit";
        if (dataCharacters > MAXIMUM_FRAME_CHARACTERS)
          throw new DeepSeekAnalysisModelError("model_response_invalid");
        data.push(value);
      } else if (!line.startsWith(":"))
        throw new DeepSeekAnalysisModelError("model_response_invalid");
    }
    stage = "frame-limit";
    // A trailing CR is held only to detect CRLF; it is not part of the pending line.
    const pendingLineCharacters = pending.length - (pending.endsWith("\r") ? 1 : 0);
    if (pendingLineCharacters > MAXIMUM_FRAME_CHARACTERS)
      throw new DeepSeekAnalysisModelError("model_response_invalid");
  }
  function rejectTerminal(failureStage: StreamFailureStage): never {
    stage = failureStage;
    throw new DeepSeekAnalysisModelError("model_response_invalid", undefined, usage);
  }
  try {
    for (;;) {
      stage = "read";
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      stage = "wire-limit";
      if (bytes > MAXIMUM_WIRE_BYTES)
        throw new DeepSeekAnalysisModelError("model_response_invalid");
      stage = "utf8";
      pending += decoder.decode(chunk.value, { stream: true });
      consume();
    }
    stage = "utf8";
    pending += decoder.decode();
    consume(true);
    // Diagnose token exhaustion only after all structural terminal checks pass.
    // Empty content retains its original response error, even with a length finish.
    if (!done) rejectTerminal("missing-done");
    if (!id) rejectTerminal("missing-identity");
    if (!usage) rejectTerminal("missing-usage");
    if (pending.trim() !== "") rejectTerminal("pending-terminal");
    if (data.length > 0) rejectTerminal("unterminated-frame");
    if (!finish) rejectTerminal("missing-finish");
    if (content === "")
      rejectTerminal(finish === "length" ? "token-limit-empty-content" : "empty-content");
    stage = finish === "length" ? "token-limit-with-content" : "non-stop-finish";
    if (finish !== "stop")
      throw new DeepSeekAnalysisModelError("model_output_invalid", undefined, usage);
    return { content, usage };
  } catch (error) {
    if (stage && !(error instanceof DeepSeekAnalysisModelError && error.code === "model_timeout"))
      warn(stage);
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
