import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import {
  createProviderValidationDiagnosticSink,
  createNativeHostDispatcher,
  readNativeHostConfiguration,
  runNativeHost,
  type RequestDispatcher,
} from "./main.js";
import { NativeMessageDispatcher } from "./protocol/dispatcher.js";
import { NativeMessageDecoder, encodeNativeMessage } from "./protocol/framing.js";
import type { AnalysisProvider } from "./provider/analysis-provider.js";
import { APP_SERVER_DISABLED_FEATURES } from "./runtime/codex-app-server-config.js";
import type {
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "./runtime/codex-process.js";
import type { EudicFetch } from "./wordbook/eudic-client.js";
import { EudicOperationExecutor } from "./wordbook/eudic-operation-executor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryWordSyncStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "huayi-main-word-sync-"));
  temporaryDirectories.push(directory);
  return join(directory, "word-sync-state.json");
}

class HealthDispatcher implements RequestDispatcher {
  dispatch(_message: unknown, emit: (event: HostEvent) => void): void {
    emit({
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.3.0",
      model: "gpt-5.4-mini",
      provider: "codex",
      ready: true,
      requestId: "health-1",
      schemaVersion: 7,
      type: "health-result",
    });
  }
}

describe("runNativeHost", () => {
  it("writes only bounded allowlisted provider diagnostics to the injected stderr sink", () => {
    const errorOutput = new PassThrough();
    const chunks: Buffer[] = [];
    const fakeSecret = "fake-secret-token";
    errorOutput.on("data", (chunk: Buffer) => chunks.push(chunk));
    const writeDiagnostic = createProviderValidationDiagnosticSink(errorOutput);

    writeDiagnostic({
      field: "partOfSpeech",
      stage: "model-schema",
      modelJson: JSON.stringify({ value: fakeSecret }),
      context: `Context ${fakeSecret}`,
      token: fakeSecret,
    } as never);
    writeDiagnostic({ field: fakeSecret, stage: "model-json" } as never);

    const diagnostics = Buffer.concat(chunks).toString("utf8");
    expect(diagnostics).toBe(
      "Native host provider validation: stage=model-schema field=partOfSpeech\n" +
        "Native host provider validation: stage=model-json\n",
    );
    expect(diagnostics).not.toContain(fakeSecret);
    expect(diagnostics.split("\n").every((line) => line.length <= 160)).toBe(true);
  });

  it("writes only framed protocol data to stdout", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    errorOutput.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    const stop = runNativeHost({
      dispatcher: new HealthDispatcher(),
      errorOutput,
      input,
      output,
    });

    input.write(encodeNativeMessage({ requestId: "health-1", schemaVersion: 7, type: "health" }));
    await vi.waitFor(() => expect(outputChunks.length).toBe(1));

    const decoder = new NativeMessageDecoder();
    expect(decoder.push(Buffer.concat(outputChunks))).toEqual([
      {
        codexVersion: "codex-cli 0.144.1",
        hostVersion: "0.3.0",
        model: "gpt-5.4-mini",
        provider: "codex",
        ready: true,
        requestId: "health-1",
        schemaVersion: 7,
        type: "health-result",
      },
    ]);
    expect(Buffer.concat(errorChunks).toString("utf8")).toBe("");
    stop();
  });

  it("writes framing failures only to stderr and stops reading", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    errorOutput.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    runNativeHost({
      dispatcher: new HealthDispatcher(),
      errorOutput,
      input,
      output,
    });

    input.write(Buffer.alloc(4));
    await vi.waitFor(() => expect(errorChunks.length).toBe(1));

    expect(outputChunks).toEqual([]);
    expect(Buffer.concat(errorChunks).toString("utf8")).toContain("Native host protocol error");
  });

  it.each([
    ["ends", (input: PassThrough) => input.end()],
    ["closes", (input: PassThrough) => input.destroy()],
  ])("aborts active work and disposes the provider when stdin %s", async (_event, closeInput) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errorOutput = new PassThrough();
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let activeWorkStarted = false;
    let aborted = 0;
    let providerDisposeCalls = 0;
    output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    errorOutput.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    const provider: AnalysisProvider = {
      warmup: async () => undefined,
      analyze: (_request, signal) => {
        activeWorkStarted = true;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted += 1;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      },
      dispose: () => {
        providerDisposeCalls += 1;
      },
    };
    const dispatcher = new NativeMessageDispatcher({
      healthCheck: async () => ({
        codexVersion: "codex-cli 0.144.1",
        model: "gpt-5.4-mini",
        provider: "codex",
      }),
      provider,
    });
    const stop = runNativeHost({ dispatcher, errorOutput, input, output });

    try {
      input.write(
        encodeNativeMessage({
          action: "translate",
          context: "The investigation was in its early stages.",
          requestId: "analysis-stdin-close",
          schemaVersion: 7,
          selection: "investigation",
          selectionKind: "word",
          sentenceContext: null,
          targetLanguage: "zh-CN",
          type: "analyze",
        }),
      );
      await vi.waitFor(() => expect(activeWorkStarted).toBe(true));
      const outputLengthBeforeClose = Buffer.concat(outputChunks).length;

      closeInput(input);
      await vi.waitFor(() => expect(aborted).toBe(1));
      await Promise.resolve();

      stop();
      expect(providerDisposeCalls).toBe(1);
      expect(Buffer.concat(outputChunks)).toHaveLength(outputLengthBeforeClose);
      expect(Buffer.concat(errorChunks).toString("utf8")).toBe("");
    } finally {
      stop();
    }
  });
});

describe("native host bootstrap", () => {
  it("requires absolute installer-owned runtime paths", () => {
    expect(() => readNativeHostConfiguration({ HUAYI_CODEX_PATH: "/opt/codex" })).toThrow(
      /HUAYI_WORK_DIR/,
    );
    expect(() =>
      readNativeHostConfiguration({
        HUAYI_CODEX_PATH: "codex",
        HUAYI_SCHEMA_DIR: "/tmp/schemas",
        HUAYI_WORK_DIR: "/tmp/work",
      }),
    ).toThrow(/absolute/);
  });

  it("wires health checks to capability detection without invoking an analysis", async () => {
    const results: ProcessRunResult[] = [
      { exitCode: 0, signal: null, stderr: "", stdout: "codex-cli 0.144.1" },
      {
        exitCode: 0,
        signal: null,
        stderr: "",
        stdout: ["--stdio", "--strict-config", "--disable", "--config"].join("\n"),
      },
      {
        exitCode: 0,
        signal: null,
        stderr: "",
        stdout: APP_SERVER_DISABLED_FEATURES.map((feature) => `${feature} stable false`).join("\n"),
      },
      { exitCode: 0, signal: null, stderr: "", stdout: "Logged in using ChatGPT" },
    ];
    const requests: ProcessRunRequest[] = [];
    const processRunner: ProcessRunner = {
      run: async (request) => {
        requests.push(request);
        const result = results.shift();
        if (result === undefined) {
          throw new Error("Missing fake result.");
        }
        return result;
      },
    };
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      environment: { HOME: "/Users/tester" },
      errorOutput: new PassThrough(),
      processRunner,
      providerConfigurationPath: "/nonexistent/huayi-provider.json",
      schemaDirectory: "/tmp/schemas",
      workingDirectory: "/tmp/work",
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch({ requestId: "health-2", schemaVersion: 7, type: "health" }, (event) =>
      events.push(event),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.13.0",
      model: "gpt-5.4-mini",
      provider: "codex",
      ready: true,
    });
    expect(requests.map((request) => request.arguments)).toEqual([
      ["--version"],
      ["app-server", "--help"],
      [
        "features",
        "list",
        ...APP_SERVER_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      ],
      ["login", "status"],
    ]);
    expect(requests.some((request) => request.arguments[0] === "mcp")).toBe(false);
    dispatcher.dispose();
  });

  it("injects one Eudic operation executor into macOS wordbook and word-sync services", async () => {
    const eudicAuthorizationReader = {
      read: vi.fn(async () => "Bearer fixture"),
    };
    const eudicOperationExecutor = new EudicOperationExecutor({
      authorizationReader: eudicAuthorizationReader,
    });
    const executeEudicOperation = vi.spyOn(eudicOperationExecutor, "execute");
    const eudicFetch = vi.fn<EudicFetch>(async (url) => {
      const body =
        url.includes("/vocab_entries") || url.includes("/words?")
          ? { data: [], message: "" }
          : { data: [] };
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    const wordSyncStatePath = await createTemporaryWordSyncStatePath();
    const dispatcher = createNativeHostDispatcher({
      codexExecutable: "/opt/codex",
      environment: { HOME: "/Users/tester" },
      errorOutput: new PassThrough(),
      eudicAuthorizationReader,
      eudicFetch,
      eudicOperationExecutor,
      processRunner: {
        run: vi.fn(async () => {
          throw new Error("Process runner must not run.");
        }),
      },
      schemaDirectory: "/tmp/schemas",
      workingDirectory: "/tmp/work",
      wordSyncNow: () => new Date(2026, 7, 9, 12, 0, 0, 0),
      wordSyncStatePath,
    });
    const events: HostEvent[] = [];

    dispatcher.dispatch(
      {
        language: "en",
        requestId: "check-shared-macos",
        schemaVersion: 7,
        type: "check-word",
        word: "investigation",
      },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === "word-status")).toBe(true));
    dispatcher.dispatch(
      { requestId: "sync-shared-macos", schemaVersion: 7, type: "word-sync-poll" },
      (event) => events.push(event),
    );
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) => event.type === "word-sync-status" && event.requestId === "sync-shared-macos",
        ),
      ).toBe(true),
    );

    expect(executeEudicOperation).toHaveBeenCalledTimes(2);
    expect(eudicAuthorizationReader.read).toHaveBeenCalledTimes(2);
    dispatcher.dispose();
  });
});
