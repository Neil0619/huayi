import {
  STORE_MESSAGE_VERSION,
  isSiteEnabled,
  normalizeObservationSentence,
  parseStoreLexiconRequest,
  recipientAccessDecision,
  type LexiconRepository,
  type StoreLexiconErrorCode,
  type StoreLexiconResponse,
  type StoreSettings,
  type WordbookExportEngine,
} from "@huayi/store-domain";

import { siteHostFromSenderUrl } from "./site-policy-handler.js";

type RelevantSettings = Pick<StoreSettings, "globallyEnabled" | "recipientAccess" | "sitePolicy">;
type ReadSettings = () => Promise<RelevantSettings>;
type TrustedObservationSource = "web" | "youtube";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

function sourceFromSender(value: string | undefined): TrustedObservationSource | null {
  if (value === undefined) return null;
  let sender: URL;
  try {
    sender = new URL(value);
  } catch {
    return null;
  }
  if (sender.protocol !== "http:" && sender.protocol !== "https:") return null;
  if (YOUTUBE_HOSTS.has(sender.hostname.toLowerCase())) {
    return sender.protocol === "https:" && sender.pathname === "/watch" ? "youtube" : null;
  }
  return "web";
}

export function isStoreLexiconMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    typeof value.type === "string" &&
    value.type.startsWith("store/lexicon-")
  );
}

function errorResponse(code: StoreLexiconErrorCode): StoreLexiconResponse {
  return { code, messageVersion: STORE_MESSAGE_VERSION, type: "store/lexicon-error" };
}

function errorCode(error: unknown): StoreLexiconErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "data-corrupt") return error.code;
  }
  return "internal-error";
}

export async function handleLexiconMessage(
  value: unknown,
  lexicon: LexiconRepository,
  wordbook?: WordbookExportEngine,
  readSettings?: ReadSettings,
  senderUrl?: string,
): Promise<StoreLexiconResponse | undefined> {
  if (!isStoreLexiconMessage(value)) return undefined;
  let request;
  try {
    request = parseStoreLexiconRequest(value);
  } catch {
    return errorResponse("invalid-request");
  }
  try {
    let trustedSettings: RelevantSettings | undefined;
    if (readSettings !== undefined) {
      const siteHost = siteHostFromSenderUrl(senderUrl);
      if (siteHost === null) return errorResponse("invalid-request");
      try {
        trustedSettings = await readSettings();
      } catch {
        return errorResponse("internal-error");
      }
      if (!isSiteEnabled(trustedSettings, siteHost)) return errorResponse("invalid-request");
    }
    const enqueue = async (entryId: string): Promise<void> => {
      if (wordbook === undefined || trustedSettings === undefined) return;
      const targets = (["eudic", "shanbay"] as const).filter(
        (recipient) => recipientAccessDecision(trustedSettings, recipient) === "allowed",
      );
      if (targets.length > 0) await wordbook.enqueue(entryId, targets);
    };
    const existing = await lexicon.findByHeadword(request.headword);
    if (request.type === "store/lexicon-presence") {
      return {
        messageVersion: STORE_MESSAGE_VERSION,
        present: existing !== null,
        type: "store/lexicon-presence-result",
      };
    }
    const source = sourceFromSender(senderUrl);
    if (source === null) return errorResponse("invalid-request");
    const sentenceKey = normalizeObservationSentence(request.sentence);
    const duplicate = existing?.contexts.some(
      (context) =>
        context.source === source && normalizeObservationSentence(context.sentence) === sentenceKey,
    );
    if (duplicate === true && existing !== null) {
      await enqueue(existing.id);
      return {
        messageVersion: STORE_MESSAGE_VERSION,
        status: "duplicate",
        type: "store/lexicon-save-result",
      };
    }
    const saved = await lexicon.save({
      context: {
        contextualMeaningZh: request.contextualMeaningZh,
        sentence: request.sentence,
        source,
      },
      headword: request.headword,
    });
    await enqueue(saved.id);
    return {
      messageVersion: STORE_MESSAGE_VERSION,
      status: "saved",
      type: "store/lexicon-save-result",
    };
  } catch (error) {
    return errorResponse(errorCode(error));
  }
}
