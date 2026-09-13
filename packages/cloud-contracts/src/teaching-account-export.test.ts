import { expect, it } from "vitest";
import {
  accountDataExportFormatRequestSchema,
  accountDataExportJobReadResourceSchema,
  accountDataExportRecordReadSchema,
  accountDataExportRecordSchema,
  accountDataExportRecordV2Schema,
  practiceTeachingDetailSchema,
  projectAccountDataExportRecordForLegacy,
  projectAccountDataExportRecordForV2,
  accountDataExportRecordV3Schema,
} from "./index.js";

const time = "2026-09-13T00:00:00.000Z";
function practiceRecord() {
  const answers = [0, 1].map((ordinal) => ({
    id: `answer-${ordinal}`,
    itemIds: ["item"],
    answer: `I need at least ${ordinal + 1} days.`,
    feedback: "表达清楚。",
    submittedAt: time,
  }));
  const detail = practiceTeachingDetailSchema.parse({
    version: 1,
    session: {
      id: "session",
      type: "sentence-creation",
      status: "completed",
      revision: 6,
      createdAt: time,
      updatedAt: time,
      prompt: "说明所需时间。",
      finalFeedback: "表达清楚。",
      items: [
        {
          itemId: "item",
          position: 0,
          scheduleBefore: { level: -1, dueAt: null, consecutiveMastered: 0 },
        },
      ],
      attempts: answers,
      turns: [],
      workspace: {
        phase: "active",
        mode: "guided",
        draft: "",
        draftRevision: 1,
        controlRevision: 2,
      },
    },
    teaching: {
      contract: "practice-teaching-v1",
      hintPolicy: "on-demand",
      target: {
        state: "available",
        itemId: "item",
        capturedAt: time,
        content: {
          type: "expression",
          text: "at least",
          meaningZh: "至少",
          usageZh: "说明最小值。",
        },
      },
      round: { ordinal: 1, parentAttemptId: "answer-0", hintViewedAt: time },
      attempts: answers.map((answer, ordinal) => ({
        attemptId: answer.id,
        ordinal,
        parentAttemptId: ordinal ? "answer-0" : null,
        hintViewedAt: ordinal ? time : null,
        feedback: null,
        feedbackCompletedAt: null,
      })),
    },
  });
  return {
    recordType: "practice-session" as const,
    session: detail.session,
    teaching: detail.teaching,
  };
}

it("explicitly accepts export format 3 while retaining strict old manifests and jobs", () => {
  expect(accountDataExportFormatRequestSchema.parse({ formatVersion: 3 })).toEqual({
    formatVersion: 3,
  });
  const manifest = {
    recordType: "manifest",
    product: "huayi-cloud",
    exportedAt: time,
    schemaVersion: 3,
  };
  expect(accountDataExportRecordReadSchema.parse(manifest)).toEqual(manifest);
  expect(accountDataExportRecordSchema.safeParse(manifest).success).toBe(false);
  expect(accountDataExportRecordV2Schema.safeParse(manifest).success).toBe(false);
  expect(
    accountDataExportJobReadResourceSchema.parse({
      id: "export",
      state: "pending",
      revision: 1,
      formatVersion: 3,
      createdAt: time,
      updatedAt: time,
    }).formatVersion,
  ).toBe(3);
});

it("exports the saved ordered teaching sidecar and keeps formats 1/2 strict", () => {
  const record = practiceRecord();
  expect(accountDataExportRecordReadSchema.parse(record)).toEqual(record);
  expect(accountDataExportRecordSchema.safeParse(record).success).toBe(false);
  expect(accountDataExportRecordV2Schema.safeParse(record).success).toBe(false);
  const old = { recordType: record.recordType, session: record.session };
  expect(projectAccountDataExportRecordForLegacy(record)).toEqual(old);
  expect(projectAccountDataExportRecordForV2(record)).toEqual(old);
  expect(accountDataExportRecordV3Schema.safeParse(old).success).toBe(false);
  expect(accountDataExportRecordReadSchema.parse({ ...record, teaching: null })).toEqual({
    ...record,
    teaching: null,
  });
});

it("rejects mismatched attempt metadata and cannot export an erased target snapshot", () => {
  const record = practiceRecord();
  expect(
    accountDataExportRecordReadSchema.safeParse({
      ...record,
      teaching: { ...record.teaching, attempts: [] },
    }).success,
  ).toBe(false);
  expect(
    accountDataExportRecordReadSchema.safeParse({
      ...record,
      session: {
        ...record.session,
        items: record.session.items.map((item) => ({ ...item, learningItemDeletedAt: time })),
      },
    }).success,
  ).toBe(false);
});
