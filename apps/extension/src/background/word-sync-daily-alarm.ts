export const WORD_SYNC_DAILY_HOUR = 8;
export const WORD_SYNC_DAILY_ALARM = "huayi-word-sync-daily";

export interface WordSyncDailyAlarmBrowser {
  createAlarm(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): void;
  getAlarm(name: string): Promise<chrome.alarms.Alarm | undefined>;
}

export interface DailyAlarm {
  periodInMinutes?: number | undefined;
  scheduledTime: number;
}

export function nextWordSyncDailyAlarmTime(now: Date): number {
  const scheduled = new Date(now);
  scheduled.setHours(WORD_SYNC_DAILY_HOUR, 0, 0, 0);
  if (scheduled.getTime() <= now.getTime()) scheduled.setDate(scheduled.getDate() + 1);
  return scheduled.getTime();
}

export function isWordSyncDailyPollTime(now: Date): boolean {
  const today = new Date(now);
  today.setHours(WORD_SYNC_DAILY_HOUR, 0, 0, 0);
  return now.getTime() >= today.getTime();
}

export function isExpectedWordSyncDailyAlarm(alarm: DailyAlarm | undefined, now: Date): boolean {
  if (alarm === undefined) return false;
  return (
    alarm.periodInMinutes === undefined && alarm.scheduledTime === nextWordSyncDailyAlarmTime(now)
  );
}

export async function ensureWordSyncDailyAlarm(
  browser: WordSyncDailyAlarmBrowser,
  now: Date,
): Promise<void> {
  try {
    const alarm = await browser.getAlarm(WORD_SYNC_DAILY_ALARM);
    if (isExpectedWordSyncDailyAlarm(alarm, now)) return;
  } catch {
    // Chrome may be restarting; creating the alarm remains safe and idempotent by name.
  }
  scheduleNextWordSyncDailyAlarm(browser, now);
}

export function scheduleNextWordSyncDailyAlarm(
  browser: Pick<WordSyncDailyAlarmBrowser, "createAlarm">,
  now: Date,
): void {
  browser.createAlarm(WORD_SYNC_DAILY_ALARM, {
    when: nextWordSyncDailyAlarmTime(now),
  });
}
