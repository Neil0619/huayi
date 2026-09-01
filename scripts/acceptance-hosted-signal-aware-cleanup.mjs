const terminationSignals = Object.freeze(["SIGHUP", "SIGINT", "SIGTERM"]);

function requireChild(child) {
  if (
    child === null ||
    typeof child !== "object" ||
    typeof child.kill !== "function" ||
    typeof child.once !== "function"
  ) {
    throw new Error("Hosted signal-aware child is unavailable.");
  }
}

export async function withHostedSignalAwareCleanup({ cleanup, process_ = process, run }) {
  if (
    typeof cleanup !== "function" ||
    typeof run !== "function" ||
    typeof process_?.kill !== "function" ||
    typeof process_?.once !== "function" ||
    typeof process_?.removeListener !== "function"
  ) {
    throw new Error("Hosted signal-aware cleanup is unavailable.");
  }

  let activeChild;
  let cleanupPromise;
  let shutdownPromise;
  const handlers = new Map();
  const cleanupOnce = () => {
    cleanupPromise ??= Promise.resolve().then(cleanup);
    return cleanupPromise;
  };
  const removeHandlers = () => {
    for (const [signal, handler] of handlers) process_.removeListener(signal, handler);
    handlers.clear();
  };
  const throwIfTerminating = () => {
    if (shutdownPromise !== undefined) {
      throw new Error("Hosted signal-aware cleanup is terminating.");
    }
  };
  const registerChild = (child) => {
    throwIfTerminating();
    requireChild(child);
    if (activeChild !== undefined) {
      throw new Error("Hosted signal-aware child is already active.");
    }
    let resolveClose;
    const registration = {
      child,
      closed: new Promise((resolveResult) => {
        resolveClose = resolveResult;
      }),
    };
    activeChild = registration;
    child.once("close", () => {
      if (activeChild === registration) activeChild = undefined;
      resolveClose();
    });
  };
  const beginShutdown = (signal) => {
    if (shutdownPromise !== undefined) return;
    removeHandlers();
    const childAtSignal = activeChild;
    shutdownPromise = (async () => {
      if (childAtSignal !== undefined) {
        try {
          childAtSignal.child.kill("SIGKILL");
        } catch {
          // A fixed SIGKILL can race a child which has already closed.
        }
        await childAtSignal.closed;
      }
      try {
        await cleanupOnce();
      } finally {
        process_.kill(process_.pid, signal);
      }
    })();
    void shutdownPromise.catch(() => undefined);
  };

  for (const signal of terminationSignals) {
    const handler = () => beginShutdown(signal);
    handlers.set(signal, handler);
    process_.once(signal, handler);
  }

  try {
    return await run({ registerChild, throwIfTerminating });
  } finally {
    removeHandlers();
    if (shutdownPromise !== undefined) {
      await shutdownPromise;
    } else {
      await cleanupOnce();
    }
  }
}
