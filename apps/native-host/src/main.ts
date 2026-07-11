import type { Readable, Writable } from "node:stream";

import { hostEventSchema } from "@huayi/protocol";
import type { HostEvent } from "@huayi/protocol";

import { NativeMessageDecoder, encodeNativeMessage } from "./protocol/framing.js";

export interface RequestDispatcher {
  dispatch(message: unknown, emit: (event: HostEvent) => void): void;
  dispose?(): void;
}

export interface NativeHostStreams {
  dispatcher: RequestDispatcher;
  errorOutput: Writable;
  input: Readable;
  output: Writable;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown protocol error.";
}

export function runNativeHost(streams: NativeHostStreams): () => void {
  const decoder = new NativeMessageDecoder();
  let stopped = false;

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    streams.input.removeListener("data", handleData);
    streams.dispatcher.dispose?.();
  };

  const fail = (error: unknown): void => {
    streams.errorOutput.write(`Native host protocol error: ${errorMessage(error)}\n`);
    stop();
  };

  const emit = (event: HostEvent): void => {
    if (stopped) {
      return;
    }
    try {
      const validatedEvent = hostEventSchema.parse(event);
      streams.output.write(encodeNativeMessage(validatedEvent));
    } catch (error) {
      fail(error);
    }
  };

  function handleData(chunk: Buffer | string): void {
    if (stopped) {
      return;
    }

    try {
      const messages = decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      for (const message of messages) {
        if (stopped) {
          break;
        }
        streams.dispatcher.dispatch(message, emit);
      }
    } catch (error) {
      fail(error);
    }
  }

  streams.input.on("data", handleData);
  return stop;
}
