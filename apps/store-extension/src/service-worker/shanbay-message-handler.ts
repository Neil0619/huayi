import {
  STORE_MESSAGE_VERSION,
  isSiteEnabled,
  parseStoreWordbookRequest,
  recipientAccessDecision,
  type StoreWordbookResponse,
  type StoreSettings,
  type ShanbayBatch,
} from "@huayi/store-domain";

type RelevantSettings = Pick<StoreSettings, "globallyEnabled" | "recipientAccess" | "sitePolicy">;
type ReadSettings = () => Promise<RelevantSettings>;

export const SHANBAY_COLLECTION_URL = "https://web.shanbay.com/wordsweb/#/collection";
const SHANBAY_BATCH_LIMIT = 100;

interface StoreMessageSender {
  readonly url?: string | undefined;
}

function exactShanbaySender(sender: StoreMessageSender): boolean {
  if (sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.origin === "https://web.shanbay.com" &&
      url.pathname === "/wordsweb/" &&
      url.search === "" &&
      url.hash === "#/collection"
    );
  } catch {
    return false;
  }
}

function invalidRequest(): StoreWordbookResponse {
  return {
    code: "invalid-request",
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/wordbook-error",
  };
}

export async function handleShanbayMessage(
  value: unknown,
  sender: StoreMessageSender,
  wordbook: {
    claimShanbayBatch(limit: number): Promise<ShanbayBatch | null>;
    resolveShanbayBatch(
      token: string,
      confirmedOutboxIds: readonly string[],
      failedOutboxIds: readonly string[],
    ): Promise<boolean>;
  },
  readSettings: ReadSettings,
): Promise<StoreWordbookResponse | undefined> {
  const isCandidate =
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value.type === "store/shanbay-page-ready" || value.type === "store/shanbay-resolve");
  if (!isCandidate || !exactShanbaySender(sender)) return undefined;
  let request;
  try {
    request = parseStoreWordbookRequest(value);
  } catch {
    return invalidRequest();
  }
  let settings: RelevantSettings;
  try {
    settings = await readSettings();
  } catch {
    return {
      code: "internal-error",
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/wordbook-error",
    };
  }
  if (!isSiteEnabled(settings, "web.shanbay.com")) return invalidRequest();
  const decision = recipientAccessDecision(settings, "shanbay");
  if (decision !== "allowed") {
    return {
      code: decision,
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/wordbook-error",
    };
  }
  if (request.type === "store/shanbay-page-ready") {
    return {
      batch: await wordbook.claimShanbayBatch(SHANBAY_BATCH_LIMIT),
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/shanbay-batch",
    };
  }
  if (request.type !== "store/shanbay-resolve") return invalidRequest();
  return {
    accepted: await wordbook.resolveShanbayBatch(
      request.batchToken,
      request.confirmedOutboxIds,
      request.failedOutboxIds,
    ),
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/shanbay-resolved",
  };
}
