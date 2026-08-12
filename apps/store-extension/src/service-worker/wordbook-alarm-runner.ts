import {
  recipientAccessDecision,
  type StoreSettings,
  type WordbookExportEngine,
} from "@huayi/store-domain";

export const EUDIC_EXPORT_ALARM = "huayi-store-eudic-export";
export const EUDIC_IMPORT_ALARM = "huayi-store-eudic-import";
export const WORDBOOK_ALARM_DELAY_MS = 1_000;

type ScheduleAlarm = (name: string) => void;
type ReadSettings = () => Promise<Pick<StoreSettings, "recipientAccess">>;

async function eudicAllowed(readSettings: ReadSettings): Promise<boolean> {
  try {
    return recipientAccessDecision(await readSettings(), "eudic") === "allowed";
  } catch {
    return false;
  }
}

export async function runEudicImportAlarm(
  wordbook: WordbookExportEngine,
  schedule: ScheduleAlarm,
  readSettings: ReadSettings,
): Promise<void> {
  if (!(await eudicAllowed(readSettings))) return;
  const before = await wordbook.getEudicImportJob();
  if (before.state !== "running") return;
  await wordbook.processEudicImportOnce();
  const after = await wordbook.getEudicImportJob();
  if (after.state === "running") schedule(EUDIC_IMPORT_ALARM);
}

export async function runEudicExportAlarm(
  wordbook: WordbookExportEngine,
  schedule: ScheduleAlarm,
  readSettings: ReadSettings,
): Promise<void> {
  if (!(await eudicAllowed(readSettings))) return;
  await wordbook.processEudicOnce();
  const queued = await wordbook.listOutbox(["queued"]);
  if (queued.some((item) => item.target === "eudic")) schedule(EUDIC_EXPORT_ALARM);
}
