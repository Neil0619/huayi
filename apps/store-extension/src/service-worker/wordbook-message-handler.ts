import {
  STORE_MESSAGE_VERSION,
  parseStoreWordbookRequest,
  recipientAccessDecision,
  type StoreWordbookErrorCode,
  type StoreWordbookResponse,
  type StoreSettings,
  type WordbookExportEngine,
} from "@huayi/store-domain";

type ReadSettings = () => Promise<Pick<StoreSettings, "recipientAccess">>;

interface StoreMessageSender {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
}

function isWordbookCandidate(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    (value.type.startsWith("store/eudic-import-") || value.type.startsWith("store/outbox-"))
  );
}

function isExactOptionsSender(sender: StoreMessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === extensionId &&
      url.pathname === "/options.html" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function errorCode(error: unknown): StoreWordbookErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (
      code === "authentication-failed" ||
      code === "concurrent-modification" ||
      code === "credential-missing" ||
      code === "data-corrupt" ||
      code === "invalid-response" ||
      code === "network-error" ||
      code === "rate-limited" ||
      code === "timeout"
    ) {
      return code;
    }
  }
  return "internal-error";
}

function failure(code: StoreWordbookErrorCode): StoreWordbookResponse {
  return { code, messageVersion: STORE_MESSAGE_VERSION, type: "store/wordbook-error" };
}

export async function handleWordbookMessage(
  value: unknown,
  sender: StoreMessageSender,
  extensionId: string,
  wordbook: WordbookExportEngine,
  readSettings: ReadSettings,
): Promise<StoreWordbookResponse | undefined> {
  if (!isWordbookCandidate(value) || !isExactOptionsSender(sender, extensionId)) return undefined;
  let request;
  try {
    request = parseStoreWordbookRequest(value);
  } catch {
    return failure("invalid-request");
  }
  try {
    if (
      request.type === "store/eudic-import-start" ||
      request.type === "store/eudic-import-resume" ||
      request.type === "store/eudic-import-step" ||
      request.type === "store/outbox-process-one"
    ) {
      let decision;
      try {
        decision = recipientAccessDecision(await readSettings(), "eudic");
      } catch {
        return failure("internal-error");
      }
      if (decision !== "allowed") return failure(decision);
    }
    switch (request.type) {
      case "store/eudic-import-start":
        await wordbook.startEudicImport();
        await wordbook.processEudicImportOnce();
        return {
          job: await wordbook.getEudicImportJob(),
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/eudic-import-result",
        };
      case "store/eudic-import-resume":
        await wordbook.resumeEudicImport();
        await wordbook.processEudicImportOnce();
        return {
          job: await wordbook.getEudicImportJob(),
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/eudic-import-result",
        };
      case "store/eudic-import-pause":
        return {
          job: await wordbook.pauseEudicImport(),
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/eudic-import-result",
        };
      case "store/eudic-import-status":
        return {
          job: await wordbook.getEudicImportJob(),
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/eudic-import-result",
        };
      case "store/eudic-import-step":
        await wordbook.processEudicImportOnce();
        return {
          job: await wordbook.getEudicImportJob(),
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/eudic-import-result",
        };
      case "store/outbox-list":
        return {
          items: [...(await wordbook.listOutbox(request.states))],
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/outbox-result",
        };
      case "store/outbox-retry":
        await wordbook.retry(request.outboxId);
        return {
          messageVersion: STORE_MESSAGE_VERSION,
          retried: true,
          type: "store/outbox-retry-result",
        };
      case "store/outbox-process-one":
        return {
          messageVersion: STORE_MESSAGE_VERSION,
          processed: await wordbook.processEudicOnce(),
          type: "store/outbox-process-result",
        };
      default:
        return failure("invalid-request");
    }
  } catch (error) {
    return failure(errorCode(error));
  }
}
