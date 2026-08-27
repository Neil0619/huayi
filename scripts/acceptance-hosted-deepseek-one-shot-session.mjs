const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const sessionCookiePattern = /^huayi_session=[A-Za-z0-9._~-]{32,2048}$/u;
const requiredTransportMethods = Object.freeze([
  "invokeCloudWebAnalysis",
  "loginPassword",
  "logout",
  "readOperatorAuthorization",
  "reconcileDispatchedRequest",
  "reauthenticatePassword",
  "setModelKillSwitch",
]);

function failedClosed() {
  return new Error(failureMessage);
}

function isSafePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isOpaqueToken(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 2_048) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return false;
  }
  return true;
}

function inspectSessionMaterial(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !sessionCookiePattern.test(value.cookie)
  ) {
    return Object.freeze({ complete: false, material: undefined });
  }
  const complete = hasExactKeys(value, ["cookie", "csrfToken"]) && isOpaqueToken(value.csrfToken);
  return Object.freeze({
    complete,
    material: Object.freeze({
      cookie: value.cookie,
      csrfToken: complete ? value.csrfToken : undefined,
    }),
  });
}

function transportIsValid(transport) {
  return (
    typeof transport === "object" &&
    transport !== null &&
    !Array.isArray(transport) &&
    requiredTransportMethods.every((method) => typeof transport[method] === "function")
  );
}

export function createHostedDeepSeekNormalWebSessionAdapter({ transport } = {}) {
  if (!transportIsValid(transport)) throw failedClosed();
  let material;
  let state = "absent";

  function activeMaterial(requiredState) {
    if (material === undefined || (requiredState !== undefined && state !== requiredState)) {
      throw failedClosed();
    }
    return material;
  }

  return Object.freeze({
    destroySession() {
      material = undefined;
      state = "absent";
    },
    async invokeCloudWebAnalysis(request, control) {
      try {
        return await transport.invokeCloudWebAnalysis(
          activeMaterial("reauthenticated"),
          request,
          control,
        );
      } catch {
        throw failedClosed();
      }
    },
    async loginPassword(control) {
      try {
        if (state !== "absent") throw failedClosed();
        const inspected = inspectSessionMaterial(await transport.loginPassword(control));
        if (inspected.material !== undefined) {
          material = inspected.material;
          state = inspected.complete ? "login" : "logout-only";
        }
        if (!inspected.complete) throw failedClosed();
        state = "login";
      } catch {
        throw failedClosed();
      }
    },
    async logout(control) {
      try {
        await transport.logout(activeMaterial(), control);
      } catch {
        throw failedClosed();
      } finally {
        material = undefined;
        state = "absent";
      }
    },
    async readOperatorAuthorization(control) {
      try {
        return await transport.readOperatorAuthorization(
          activeMaterial("reauthenticated"),
          control,
        );
      } catch {
        throw failedClosed();
      }
    },
    async reauthenticatePassword(control) {
      try {
        const prior = activeMaterial("login");
        const inspected = inspectSessionMaterial(
          await transport.reauthenticatePassword(prior, control),
        );
        if (inspected.material !== undefined) {
          material = inspected.material;
          state = "logout-only";
        }
        if (!inspected.complete) throw failedClosed();
        const replacement = inspected.material;
        if (replacement.cookie === prior.cookie || replacement.csrfToken === prior.csrfToken) {
          throw failedClosed();
        }
        material = replacement;
        state = "reauthenticated";
      } catch {
        throw failedClosed();
      }
    },
    async reconcileDispatchedRequest(request, control) {
      try {
        return await transport.reconcileDispatchedRequest(
          activeMaterial("reauthenticated"),
          request,
          control,
        );
      } catch {
        throw failedClosed();
      }
    },
    async setModelKillSwitch(enabled, control) {
      try {
        return await transport.setModelKillSwitch(
          activeMaterial("reauthenticated"),
          enabled,
          control,
        );
      } catch {
        throw failedClosed();
      }
    },
  });
}

function createDeadline({
  budgetField,
  budgetMilliseconds,
  clearTimeout_,
  deadlineAt,
  externalSignal,
  setTimeout_,
}) {
  const controller = new AbortController();
  let rejectDeadline;
  let stopped = false;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const abort = () => {
    if (stopped) return;
    controller.abort();
    rejectDeadline(failedClosed());
  };
  const timer = setTimeout_(abort, budgetMilliseconds);
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted === true) abort();
  return {
    control: Object.freeze({
      [budgetField]: budgetMilliseconds,
      deadlineAt,
      signal: controller.signal,
    }),
    async run(action) {
      const guardedAction = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw failedClosed();
        return action();
      });
      return Promise.race([guardedAction, deadline]);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout_(timer);
      externalSignal?.removeEventListener("abort", abort);
    },
  };
}

export async function establishHostedDeepSeekNormalWebSession({
  adapter,
  budgetMilliseconds,
  clearTimeout_,
  externalSignal,
  onLoginEstablished,
  readNowMilliseconds,
  setTimeout_,
}) {
  let authorization;
  let deadline;
  let failed = false;
  try {
    const startedAt = readNowMilliseconds();
    const deadlineAt = startedAt + budgetMilliseconds;
    if (
      !isSafePositiveInteger(budgetMilliseconds) ||
      typeof onLoginEstablished !== "function" ||
      !Number.isSafeInteger(startedAt) ||
      startedAt < 0 ||
      !Number.isSafeInteger(deadlineAt)
    ) {
      throw failedClosed();
    }
    deadline = createDeadline({
      budgetField: "sessionBudgetMilliseconds",
      budgetMilliseconds,
      clearTimeout_,
      deadlineAt,
      externalSignal,
      setTimeout_,
    });
    await deadline.run(() => adapter.loginPassword(deadline.control));
    onLoginEstablished();
    await deadline.run(() => adapter.reauthenticatePassword(deadline.control));
    authorization = await deadline.run(() => adapter.readOperatorAuthorization(deadline.control));
  } catch {
    failed = true;
  }
  try {
    deadline?.stop();
  } catch {
    failed = true;
  }
  if (failed || authorization === undefined) throw failedClosed();
  return authorization;
}

export async function attemptHostedDeepSeekNormalWebLogout({
  adapter,
  budgetMilliseconds,
  clearTimeout_,
  readNowMilliseconds,
  setTimeout_,
}) {
  let completed = false;
  let deadline;
  try {
    const startedAt = readNowMilliseconds();
    const deadlineAt = startedAt + budgetMilliseconds;
    if (
      !isSafePositiveInteger(budgetMilliseconds) ||
      !Number.isSafeInteger(startedAt) ||
      startedAt < 0 ||
      !Number.isSafeInteger(deadlineAt)
    ) {
      throw failedClosed();
    }
    deadline = createDeadline({
      budgetField: "logoutBudgetMilliseconds",
      budgetMilliseconds,
      clearTimeout_,
      deadlineAt,
      setTimeout_,
    });
    await deadline.run(() => adapter.logout(deadline.control));
    completed = true;
  } catch {
    completed = false;
  }
  try {
    deadline?.stop();
  } catch {
    completed = false;
  }
  try {
    adapter.destroySession();
  } catch {
    completed = false;
  }
  return completed;
}
