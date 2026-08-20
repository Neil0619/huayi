import {
  parseLocalWordImportRequest,
  parseLocalWordImportResponse,
  type LocalWordImportResponse,
} from "@huayi/store-domain";

import type { LocalWordImporter } from "./local-word-importer.js";

interface LocalWordImportHandlerOptions {
  readonly importer: Pick<LocalWordImporter, "confirm" | "preview" | "processOne" | "status">;
  readonly runtimeId: string;
  readonly scheduleRetry: () => void;
  readonly sender: { readonly id?: string | undefined; readonly url?: string | undefined };
}

function isOptionsSender(sender: LocalWordImportHandlerOptions["sender"], runtimeId: string) {
  if (sender.id !== runtimeId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === runtimeId &&
      url.pathname === "/options.html" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export async function handleLocalWordImportMessage(
  raw: unknown,
  options: LocalWordImportHandlerOptions,
): Promise<LocalWordImportResponse | undefined> {
  if (!isOptionsSender(options.sender, options.runtimeId)) return undefined;
  let request;
  try {
    request = parseLocalWordImportRequest(raw);
  } catch {
    return undefined;
  }
  if (request.type === "store/local-word-import-preview") {
    return parseLocalWordImportResponse(await options.importer.preview());
  }
  if (request.type === "store/local-word-import-status") {
    return parseLocalWordImportResponse(await options.importer.status());
  }
  const result =
    request.type === "store/local-word-import-confirm"
      ? await options.importer.confirm(request.previewId)
      : await options.importer.processOne();
  if (result.pending) options.scheduleRetry();
  return parseLocalWordImportResponse(result.response);
}
