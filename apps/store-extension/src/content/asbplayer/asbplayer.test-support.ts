import { vi } from "vitest";

import { createAsbplayerAdapter, type AsbplayerChannel } from "./asbplayer-adapter.js";
import { parseAsbplayerPlaybackContext } from "./asbplayer-location.js";

export const TEST_MEDIA = "blob:https://app.asbplayer.dev/7fe82f76-3fde-4d82-bf92-fdaf98a2c503";
export const TEST_URL = `https://app.asbplayer.dev/?video=${encodeURIComponent(TEST_MEDIA)}&channel=test-channel`;

export function cue(overrides: Record<string, unknown> = {}) {
  return {
    text: "Hello world",
    originalStart: 1000,
    originalEnd: 2000,
    start: 9000,
    end: 10000,
    track: 0,
    ...overrides,
  };
}

export function adapterHarness() {
  let url = TEST_URL;
  const ports: {
    send: (data: unknown) => void;
    late: (data: unknown) => void;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const createChannel = vi.fn((): AsbplayerChannel => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    let saved: ((event: MessageEvent<unknown>) => void) | undefined;
    const close = vi.fn();
    ports.push({
      send: (data) =>
        listeners.forEach((listener) => listener(new MessageEvent("message", { data }))),
      late: (data) => saved?.(new MessageEvent("message", { data })),
      close,
    });
    return {
      addEventListener: (_type, listener) => {
        listeners.add(listener);
        saved = listener;
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
      close,
    };
  });
  const adapter = createAsbplayerAdapter({
    readContext: () => parseAsbplayerPlaybackContext(url, "top-level"),
    createChannel,
  });
  const port = ports[0];
  if (port === undefined) throw new Error("Test channel was not created.");
  return {
    adapter,
    port,
    ports,
    createChannel,
    navigate: (next: string) => {
      url = next;
    },
  };
}
