import type { LocalWordImporter } from "./local-word-importer.js";

export const LOCAL_WORD_IMPORT_ALARM = "huayi-cloud-local-word-import";
export const LOCAL_WORD_IMPORT_RETRY_DELAY_MS = 60_000;

export async function runLocalWordImportAlarm(
  importer: Pick<LocalWordImporter, "processOne">,
  scheduleRetry: () => void,
) {
  const result = await importer.processOne();
  if (result.pending) scheduleRetry();
  return result;
}
