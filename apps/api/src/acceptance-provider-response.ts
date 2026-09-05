import { DEEPSEEK_PLATFORM_MODEL } from "./deepseek-analysis-protocol.js";

/** Offline fixture transport only; never contacts a Provider. */
export function simulatedProviderResponse(value: unknown, stream: boolean): Response {
  const content = JSON.stringify(value);
  const base = { id: "local-acceptance-simulated-response", model: DEEPSEEK_PLATFORM_MODEL };
  const usage = {
    completion_tokens: 32,
    prompt_cache_hit_tokens: 0,
    prompt_tokens: 64,
    total_tokens: 96,
  };
  if (!stream)
    return Response.json({
      ...base,
      object: "chat.completion",
      choices: [{ finish_reason: "stop", index: 0, message: { content, role: "assistant" } }],
      usage,
    });
  const frames: string[] = [];
  for (let offset = 0; offset < content.length; offset += 80)
    frames.push(
      `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: content.slice(offset, offset + 80) }, finish_reason: null }] })}\n\n`,
    );
  frames.push(
    `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`,
  );
  return new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } });
}
