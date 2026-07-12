import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  JsonRpcChannel,
  type JsonRpcNotification,
  type JsonRpcProcess,
} from "./json-rpc-channel.js";

const MAXIMUM_LINE_BYTES = 1_048_576;
const FAKE_STDERR_SECRET = "FAKE_STDERR_SECRET_DO_NOT_EXPOSE";

class FakeJsonRpcProcess extends EventEmitter implements JsonRpcProcess {
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killCallCount = 0;

  readonly #stdinChunks: Buffer[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.#stdinChunks.push(Buffer.from(chunk));
    });
  }

  kill(): boolean {
    this.killCallCount += 1;
    return true;
  }

  stdinText(): string {
    return Buffer.concat(this.#stdinChunks).toString("utf8");
  }
}

function createChannel(maximumLineBytes = MAXIMUM_LINE_BYTES): {
  channel: JsonRpcChannel;
  process: FakeJsonRpcProcess;
} {
  const process = new FakeJsonRpcProcess();
  return {
    channel: new JsonRpcChannel({ maximumLineBytes, process }),
    process,
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  let rejection: unknown;

  try {
    await promise;
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toBeInstanceOf(Error);
  if (!(rejection instanceof Error)) {
    throw new Error("Expected the promise to reject with an Error");
  }
  return rejection;
}

describe("JsonRpcChannel", () => {
  it("writes a compact request and resolves its matching response", async () => {
    const { channel, process } = createChannel();
    const response = channel.request<{ ok: true }>("initialize", { client: "huayi" });

    expect(process.stdinText()).toBe(
      '{"id":1,"method":"initialize","params":{"client":"huayi"}}\n',
    );

    process.stdout.write('{"id":1,"result":{"ok":true}}\n');

    await expect(response).resolves.toEqual({ ok: true });
  });

  it("uses monotonically increasing request IDs", async () => {
    const { channel, process } = createChannel();
    const first = channel.request<string>("first", null);
    const second = channel.request<string>("second", { value: 2 });

    expect(process.stdinText()).toBe(
      '{"id":1,"method":"first","params":null}\n' +
        '{"id":2,"method":"second","params":{"value":2}}\n',
    );

    process.stdout.write('{"id":1,"result":"one"}\n{"id":2,"result":"two"}\n');

    await expect(Promise.all([first, second])).resolves.toEqual(["one", "two"]);
  });

  it("decodes two response lines from one stdout chunk", async () => {
    const { channel, process } = createChannel();
    const first = channel.request<string>("first", {});
    const second = channel.request<string>("second", {});

    process.stdout.write('{"id":2,"result":"two"}\n{"id":1,"result":"one"}\n');

    await expect(Promise.all([first, second])).resolves.toEqual(["one", "two"]);
  });

  it("buffers a UTF-8 response split within a multibyte character", async () => {
    const { channel, process } = createChannel();
    const response = channel.request<string>("translate", {});
    const encoded = Buffer.from('{"id":1,"result":"词义"}\n', "utf8");
    const splitAt = Buffer.byteLength('{"id":1,"result":"', "utf8") + 1;

    process.stdout.write(encoded.subarray(0, splitAt));
    process.stdout.write(encoded.subarray(splitAt));

    await expect(response).resolves.toBe("词义");
  });

  it("writes compact notifications and delivers inbound notifications", () => {
    const { channel, process } = createChannel();
    const received: JsonRpcNotification[] = [];
    const unsubscribe = channel.onNotification((notification) => received.push(notification));

    channel.notify("initialized");
    channel.notify("client/ready", { ready: true });
    expect(process.stdinText()).toBe(
      '{"method":"initialized"}\n' + '{"method":"client/ready","params":{"ready":true}}\n',
    );

    process.stdout.write(
      '{"method":"turn/started","params":{"turnId":"turn-1"}}\n' + '{"method":"heartbeat"}\n',
    );
    expect(received).toEqual([
      { method: "turn/started", params: { turnId: "turn-1" } },
      { method: "heartbeat" },
    ]);

    unsubscribe();
    process.stdout.write('{"method":"ignored"}\n');
    expect(received).toHaveLength(2);
  });

  it("rejects a matching JSON-RPC error without closing the channel", async () => {
    const { channel, process } = createChannel();
    const failed = channel.request("first", {});

    process.stdout.write('{"id":1,"error":{"code":-32000,"message":"request failed"}}\n');

    await expect(failed).rejects.toThrow(/-32000.*request failed/i);
    expect(process.killCallCount).toBe(0);

    const succeeded = channel.request<string>("second", {});
    process.stdout.write('{"id":2,"result":"ok"}\n');
    await expect(succeeded).resolves.toBe("ok");
  });

  it("fails closed on an unknown response ID", async () => {
    const { channel, process } = createChannel();
    const pending = channel.request("pending", {});

    process.stdout.write('{"id":99,"result":true}\n');

    await expect(pending).rejects.toThrow(/unknown.*id/i);
    expect(process.killCallCount).toBe(1);
  });

  it("fails closed on a duplicate terminal response", async () => {
    const { channel, process } = createChannel();
    const completed = channel.request<string>("completed", {});

    process.stdout.write('{"id":1,"result":"done"}\n');
    await expect(completed).resolves.toBe("done");

    const pending = channel.request("pending", {});
    process.stdout.write('{"id":1,"result":"duplicate"}\n');

    await expect(pending).rejects.toThrow(/unknown.*id/i);
    expect(process.killCallCount).toBe(1);
  });

  it("fails closed on malformed JSON", async () => {
    const { channel, process } = createChannel();
    const pending = channel.request("pending", {});

    process.stdout.write("not-json\n");

    await expect(pending).rejects.toThrow(/malformed.*JSON/i);
    expect(process.killCallCount).toBe(1);
  });

  it.each(["null", "[]", "42", '"text"'])(
    "fails closed on the non-object envelope %s",
    async (envelope) => {
      const { channel, process } = createChannel();
      const pending = channel.request("pending", {});

      process.stdout.write(`${envelope}\n`);

      await expect(pending).rejects.toThrow(/object.*envelope/i);
      expect(process.killCallCount).toBe(1);
    },
  );

  it("fails closed on a malformed object envelope", async () => {
    const { channel, process } = createChannel();
    const pending = channel.request("pending", {});

    process.stdout.write('{"id":1,"result":true,"error":{"code":-32000,"message":"ambiguous"}}\n');

    await expect(pending).rejects.toThrow(/malformed.*envelope/i);
    expect(process.killCallCount).toBe(1);
  });

  it("fails closed when a stdout line exceeds one MiB", async () => {
    const { channel, process } = createChannel();
    const pending = channel.request("pending", {});

    process.stdout.write(Buffer.alloc(MAXIMUM_LINE_BYTES + 1, 0x61));

    await expect(pending).rejects.toThrow(/stdout.*limit/i);
    expect(process.killCallCount).toBe(1);
  });

  it("bounds cumulative stderr without exposing its content", async () => {
    const { channel, process } = createChannel();
    const pending = channel.request("pending", {});

    process.stderr.write(Buffer.alloc(MAXIMUM_LINE_BYTES - 8, 0x78));
    process.stderr.write(`${FAKE_STDERR_SECRET} overflow`);

    const rejection = await captureRejection(pending);
    expect(rejection.message).toMatch(/stderr.*limit/i);
    expect(rejection.message.includes(FAKE_STDERR_SECRET)).toBe(false);
    expect(process.killCallCount).toBe(1);
  });

  it("sanitizes process errors and rejects every pending request", async () => {
    const { channel, process } = createChannel();
    const first = channel.request("first", {});
    const second = channel.request("second", {});

    process.emit("error", new Error(FAKE_STDERR_SECRET));

    const [firstError, secondError] = await Promise.all([
      captureRejection(first),
      captureRejection(second),
    ]);
    expect(firstError.message).toMatch(/process.*error/i);
    expect(secondError.message).toBe(firstError.message);
    expect(firstError.message.includes(FAKE_STDERR_SECRET)).toBe(false);
    expect(process.killCallCount).toBe(1);
  });

  it("fails closed when the process exits", async () => {
    const { channel, process } = createChannel();
    const pending = channel.request("pending", {});

    process.emit("exit", 17, null);

    await expect(pending).rejects.toThrow(/process.*exit/i);
    expect(process.killCallCount).toBe(1);
  });

  it("rejects pending and future requests when disposed, and terminates once", async () => {
    const { channel, process } = createChannel();
    const first = channel.request("first", {});
    const second = channel.request("second", {});
    const reason = new Error("caller stopped the channel");

    channel.dispose(reason);
    channel.dispose(new Error("must be ignored"));

    await expect(first).rejects.toBe(reason);
    await expect(second).rejects.toBe(reason);
    await expect(channel.request("late", {})).rejects.toBe(reason);
    expect(process.killCallCount).toBe(1);
    expect(process.stdinText()).not.toContain("late");
  });
});
