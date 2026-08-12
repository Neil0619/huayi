import type { EudicImportJob, WordbookExportEngine } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import {
  EUDIC_EXPORT_ALARM,
  EUDIC_IMPORT_ALARM,
  runEudicExportAlarm,
  runEudicImportAlarm,
} from "./wordbook-alarm-runner.js";

function access(allowed: boolean) {
  return async () => ({
    defaultAction: "ask" as const,
    globallyEnabled: true,
    networkConsent: null,
    providerId: "openai" as const,
    recipientAccess: {
      eudic: {
        consent: allowed ? { grantedAt: "2026-08-11T00:00:00.000Z", version: 1 as const } : null,
        enabled: allowed,
      },
      shanbay: { consent: null, enabled: false },
    },
    schemaVersion: 5 as const,
    sitePolicy: { defaultAction: "allow" as const, rules: [] },
    youtubeMode: "english" as const,
    youtubeShortcut: null,
  });
}

function engine(jobs: readonly EudicImportJob[]): WordbookExportEngine {
  let index = 0;
  return {
    cancelEntry: vi.fn(async () => undefined),
    claimShanbayBatch: vi.fn(async () => null),
    enqueue: vi.fn(async () => []),
    getEudicImportJob: vi.fn(
      async () => jobs[Math.min(index++, jobs.length - 1)] as EudicImportJob,
    ),
    listOutbox: vi.fn(async () => []),
    pauseEudicImport: vi.fn(),
    processEudicImportOnce: vi.fn(async () => true),
    processEudicOnce: vi.fn(async () => true),
    resolveShanbayBatch: vi.fn(async () => false),
    resumeEudicImport: vi.fn(),
    retry: vi.fn(async () => undefined),
    startEudicImport: vi.fn(),
  };
}

const running: EudicImportJob = {
  duplicateCount: 0,
  importedCount: 0,
  nextPage: 1,
  state: "running",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

describe("Store wordbook alarm runner", () => {
  it("processes one import page and reschedules only while running", async () => {
    const schedule = vi.fn();
    const wordbook = engine([running, { ...running, nextPage: 2 }]);
    await runEudicImportAlarm(wordbook, schedule, access(true));
    expect(wordbook.processEudicImportOnce).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(EUDIC_IMPORT_ALARM);

    const paused = engine([{ ...running, state: "paused" }]);
    await runEudicImportAlarm(paused, schedule, access(true));
    expect(paused.processEudicImportOnce).not.toHaveBeenCalled();
  });

  it("processes one Eudic outbox item and reschedules only queued Eudic work", async () => {
    const schedule = vi.fn();
    const wordbook = engine([running]);
    vi.mocked(wordbook.listOutbox).mockResolvedValueOnce([
      {
        attemptCount: 0,
        createdAt: "2026-08-11T00:00:00.000Z",
        entryId: "investigation",
        id: "outbox-1",
        state: "queued",
        target: "eudic",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    ]);
    await runEudicExportAlarm(wordbook, schedule, access(true));
    expect(wordbook.processEudicOnce).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(EUDIC_EXPORT_ALARM);
  });

  it("blocks import and export alarms before engine access when consent is absent", async () => {
    const schedule = vi.fn();
    const wordbook = engine([running]);
    await runEudicImportAlarm(wordbook, schedule, access(false));
    await runEudicExportAlarm(wordbook, schedule, access(false));
    expect(wordbook.getEudicImportJob).not.toHaveBeenCalled();
    expect(wordbook.processEudicImportOnce).not.toHaveBeenCalled();
    expect(wordbook.processEudicOnce).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});
