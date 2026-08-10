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

export function nextWordSyncDailyAlarmTime(now: Date, hour = WORD_SYNC_DAILY_HOUR): number {
  const scheduled = new Date(now);
  scheduled.setHours(hour, 0, 0, 0);
  if (scheduled.getTime() <= now.getTime()) scheduled.setDate(scheduled.getDate() + 1);
  return scheduled.getTime();
}

export function isWordSyncDailyPollTime(now: Date, hour = WORD_SYNC_DAILY_HOUR): boolean {
  const today = new Date(now);
  today.setHours(hour, 0, 0, 0);
  return now.getTime() >= today.getTime();
}

export function isExpectedWordSyncDailyAlarm(
  alarm: DailyAlarm | undefined,
  now: Date,
  hour = WORD_SYNC_DAILY_HOUR,
): boolean {
  if (alarm === undefined) return false;
  return (
    alarm.periodInMinutes === undefined &&
    alarm.scheduledTime === nextWordSyncDailyAlarmTime(now, hour)
  );
}

export async function ensureWordSyncDailyAlarm(
  browser: WordSyncDailyAlarmBrowser,
  now: Date,
  hour = WORD_SYNC_DAILY_HOUR,
): Promise<void> {
  try {
    const alarm = await browser.getAlarm(WORD_SYNC_DAILY_ALARM);
    if (isExpectedWordSyncDailyAlarm(alarm, now, hour)) return;
  } catch {
    // Chrome may be restarting; creating the alarm remains safe and idempotent by name.
  }
  scheduleNextWordSyncDailyAlarm(browser, now, hour);
}

export function scheduleNextWordSyncDailyAlarm(
  browser: Pick<WordSyncDailyAlarmBrowser, "createAlarm">,
  now: Date,
  hour = WORD_SYNC_DAILY_HOUR,
): void {
  browser.createAlarm(WORD_SYNC_DAILY_ALARM, {
    when: nextWordSyncDailyAlarmTime(now, hour),
  });
}
