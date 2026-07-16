import type { CompatibleHttpResponseEvent } from "./compatible-http-responses-events.js";

interface SuccessfulCompatibleEventsOptions {
  readonly detailedTerminal?: boolean;
  readonly rateLimits?: boolean;
  readonly reasoning?: boolean;
  readonly terminalSequence?: number | null;
}

export function successfulCompatibleEvents(
  text: string,
  options: SuccessfulCompatibleEventsOptions = {},
): CompatibleHttpResponseEvent[] {
  let sequence = 0;
  const next = () => sequence++;
  const events: CompatibleHttpResponseEvent[] = [];
  if (options.rateLimits) events.push({ sequence: null, type: "codex.rate_limits" });
  events.push(
    { responseId: "resp-1", sequence: next(), type: "response.created" },
    { responseId: "resp-1", sequence: next(), type: "response.in_progress" },
  );
  if (options.reasoning) {
    events.push(
      {
        itemId: "reasoning-1",
        itemType: "reasoning",
        outputIndex: 0,
        sequence: next(),
        type: "response.output_item.added",
      },
      {
        itemId: "reasoning-1",
        itemType: "reasoning",
        outputIndex: 0,
        sequence: next(),
        text: null,
        type: "response.output_item.done",
      },
    );
  }
  const assistantOutputIndex = options.reasoning ? 1 : 0;
  events.push(
    {
      itemId: "message-1",
      itemType: "message",
      outputIndex: assistantOutputIndex,
      sequence: next(),
      type: "response.output_item.added",
    },
    {
      itemId: "message-1",
      outputIndex: assistantOutputIndex,
      sequence: next(),
      text: "",
      type: "response.content_part.added",
    },
    {
      delta: text.slice(0, 30),
      itemId: "message-1",
      outputIndex: assistantOutputIndex,
      sequence: next(),
      type: "response.output_text.delta",
    },
    {
      delta: text.slice(30),
      itemId: "message-1",
      outputIndex: assistantOutputIndex,
      sequence: next(),
      type: "response.output_text.delta",
    },
    {
      itemId: "message-1",
      outputIndex: assistantOutputIndex,
      sequence: next(),
      text,
      type: "response.output_text.done",
    },
  );
  if (options.detailedTerminal) {
    events.push(
      {
        itemId: "message-1",
        outputIndex: assistantOutputIndex,
        sequence: next(),
        text,
        type: "response.content_part.done",
      },
      {
        itemId: "message-1",
        itemType: "message",
        outputIndex: assistantOutputIndex,
        sequence: next(),
        text,
        type: "response.output_item.done",
      },
    );
  }
  events.push({
    itemId: options.detailedTerminal ? null : "message-1",
    responseId: "resp-1",
    sequence: options.terminalSequence === undefined ? next() : options.terminalSequence,
    text,
    type: "response.completed",
  });
  return events;
}
