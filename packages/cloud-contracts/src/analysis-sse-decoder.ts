import { analysisSseEnvelopeSchema, type AnalysisEvent } from "./analysis-contracts.js";

interface PendingEnvelope {
  data?: string;
  event?: string;
  id?: string;
}

export interface AnalysisSseDecoder<Event = AnalysisEvent> {
  finish(): Event[];
  push(text: string): Event[];
}

export function createAnalysisSseDecoder(
  limits: { eventCharacters: number; totalCharacters: number } = {
    eventCharacters: 64 * 1_024,
    totalCharacters: 2 * 1_024 * 1_024,
  },
): AnalysisSseDecoder {
  return createAnalysisEventSseDecoder(
    (value) => analysisSseEnvelopeSchema.parse(value).data,
    limits,
  );
}

export function createAnalysisEventSseDecoder<Event>(
  parseEnvelope: (value: unknown) => Event,
  limits = { eventCharacters: 64 * 1_024, totalCharacters: 2 * 1_024 * 1_024 },
): AnalysisSseDecoder<Event> {
  let buffered = "";
  let pending: PendingEnvelope = {};
  let eventCharacters = 0;
  let totalCharacters = 0;

  function parseData(data: string | undefined): unknown {
    try {
      return JSON.parse(data ?? "") as unknown;
    } catch {
      throw new Error("Invalid analysis event stream.");
    }
  }

  function consumeLine(line: string): Event | undefined {
    if (line === "") {
      eventCharacters = 0;
      if (Object.keys(pending).length === 0) return undefined;
      const event = parseEnvelope({
        ...pending,
        data: parseData(pending.data),
      });
      pending = {};
      return event;
    }
    if (line.startsWith(":")) return undefined;
    const separator = line.indexOf(":");
    if (separator < 0) throw new Error("Invalid analysis event stream.");
    const field = line.slice(0, separator);
    const rawValue = line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field !== "data" && field !== "event" && field !== "id") {
      throw new Error("Invalid analysis event stream.");
    }
    if (pending[field] !== undefined) throw new Error("Invalid analysis event stream.");
    pending[field] = value;
    return undefined;
  }

  function push(text: string): Event[] {
    totalCharacters += text.length;
    if (totalCharacters > limits.totalCharacters) {
      throw new Error("Analysis event stream exceeded its limit.");
    }
    buffered += text;
    const events: Event[] = [];
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      let line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      eventCharacters += line.length + 1;
      if (eventCharacters > limits.eventCharacters) {
        throw new Error("Analysis event stream exceeded its limit.");
      }
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.includes("\r")) throw new Error("Invalid analysis event stream.");
      const event = consumeLine(line);
      if (event !== undefined) events.push(event);
      newline = buffered.indexOf("\n");
    }
    if (eventCharacters + buffered.length > limits.eventCharacters) {
      throw new Error("Analysis event stream exceeded its limit.");
    }
    return events;
  }

  return {
    finish() {
      if (buffered !== "" || Object.keys(pending).length !== 0) {
        throw new Error("Incomplete analysis event stream.");
      }
      return [];
    },
    push,
  };
}
