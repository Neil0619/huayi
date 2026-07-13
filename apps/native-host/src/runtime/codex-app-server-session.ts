import type { AppServerSession } from "./codex-app-server-lifecycle.js";
import { MonitoredJsonRpcProcess } from "./codex-app-server-process-monitor.js";
import { DEFAULT_MAXIMUM_OUTPUT_BYTES } from "./codex-process.js";
import { JsonRpcChannel, type JsonRpcProcess } from "./json-rpc-channel.js";

export interface CreateAppServerSessionOptions {
  onProcessFailure(session: AppServerSession): void;
  onProtocolFailure(session: AppServerSession): void;
  process: JsonRpcProcess;
}

export function createAppServerSession(options: CreateAppServerSessionOptions): AppServerSession {
  const sessionHolder: { current?: AppServerSession } = {};
  const monitoredProcess = new MonitoredJsonRpcProcess({
    isClosing: () => sessionHolder.current?.closed ?? true,
    onProcessFailure: () => {
      if (sessionHolder.current !== undefined) {
        options.onProcessFailure(sessionHolder.current);
      }
    },
    onProtocolFailure: () => {
      if (sessionHolder.current !== undefined) {
        options.onProtocolFailure(sessionHolder.current);
      }
    },
    process: options.process,
  });
  const session: AppServerSession = {
    channel: new JsonRpcChannel({
      maximumLineBytes: DEFAULT_MAXIMUM_OUTPUT_BYTES,
      process: monitoredProcess,
    }),
    closed: false,
    ready: false,
  };
  sessionHolder.current = session;
  return session;
}
