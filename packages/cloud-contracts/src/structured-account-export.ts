import { z } from "zod/v3";
import {
  analysisRecordReadSchema,
  storeAnalysisReadResultSchema,
  projectAnalysisRecordForLegacy,
  projectStoreResultForLegacy,
} from "@huayi/learning-domain";
import {
  accountDataExportRecordSchema,
  accountDataExportJobResourceSchema,
  retryAccountDataExportRequestSchema,
  type AccountDataExportRecord,
} from "./account-data-rights-contracts.js";
import { practiceTeachingDetailSchema } from "./practice-teaching.js";
import { practiceReferenceArchiveSchema } from "./practice-reference.js";

export const accountDataExportFormatVersionSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type AccountDataExportFormatVersion = z.infer<typeof accountDataExportFormatVersionSchema>;
export const accountDataExportFormatRequestSchema = z.strictObject({
  formatVersion: accountDataExportFormatVersionSchema.optional(),
});
export const retryAccountDataExportReadRequestSchema = retryAccountDataExportRequestSchema.extend({
  formatVersion: accountDataExportFormatVersionSchema.optional(),
});
const format = { formatVersion: accountDataExportFormatVersionSchema };
const jobs = accountDataExportJobResourceSchema.options;
export const accountDataExportJobReadResourceSchema = z.discriminatedUnion("state", [
  jobs[0].extend(format),
  jobs[1].extend(format),
  jobs[2].extend(format),
  jobs[3].extend(format),
  jobs[4].extend(format),
]);
export type AccountDataExportJobReadResource = z.infer<
  typeof accountDataExportJobReadResourceSchema
>;
export const currentAccountDataExportReadResponseSchema = z.strictObject({
  job: accountDataExportJobReadResourceSchema.nullable(),
});

const records = accountDataExportRecordSchema.options;
const generation = {
  outputContract: z.literal("structured-teaching-v1").optional(),
  sourceText: z.string().min(1).max(2000).regex(/\S/u),
};
function querySource<
  T extends {
    outputContract?: "structured-teaching-v1" | undefined;
    action: "translate" | "explain";
    selectionKind: "word" | "phrase" | "sentence" | "passage";
    sourceText: string;
  },
>(value: T): T {
  return value.outputContract === "structured-teaching-v1" &&
    value.action === "explain" &&
    (value.selectionKind === "sentence" || value.selectionKind === "passage")
    ? value
    : { ...value, sourceText: value.sourceText.trim() };
}
/** A v2 manifest identifies the full native export; unrelated record allowlists stay frozen. */
export const accountDataExportRecordV2Schema = z.union([
  records[0].extend({ schemaVersion: z.literal(2) }),
  records[1],
  records[2],
  records[3].extend(generation).transform(querySource),
  records[4]
    .extend({ ...generation, result: storeAnalysisReadResultSchema })
    .transform(querySource),
  records[5].extend(generation).transform(querySource),
  records[6],
  records[7].extend({ analysis: analysisRecordReadSchema }),
  records[8],
  records[9],
  records[10],
]);
const teachingRecord = practiceTeachingDetailSchema
  .innerType()
  .omit({ version: true })
  .extend({ recordType: z.literal("practice-session") })
  .superRefine(({ session, teaching }, context) => {
    const checked = practiceTeachingDetailSchema.safeParse({ version: 1, session, teaching });
    if (!checked.success) for (const issue of checked.error.issues) context.addIssue(issue);
  });
const nativeRecords = accountDataExportRecordV2Schema.options;
/** Format 3 adds exact teaching metadata; the format 1/2 allowlists remain unchanged. */
export const accountDataExportRecordV3Schema = z.union([
  nativeRecords[0].extend({ schemaVersion: z.literal(3) }),
  nativeRecords[1],
  nativeRecords[2],
  nativeRecords[3],
  nativeRecords[4],
  nativeRecords[5],
  nativeRecords[6],
  nativeRecords[7],
  nativeRecords[8],
  nativeRecords[9],
  teachingRecord,
]);
/** Format 4 includes the saved reference and explicit view facts, without private generation state. */
export const accountDataExportRecordV4Schema = z.union([
  nativeRecords[0].extend({ schemaVersion: z.literal(4) }),
  nativeRecords[1],
  nativeRecords[2],
  nativeRecords[3],
  nativeRecords[4],
  nativeRecords[5],
  nativeRecords[6],
  nativeRecords[7],
  nativeRecords[8],
  nativeRecords[9],
  teachingRecord
    .innerType()
    .extend({ reference: practiceReferenceArchiveSchema.nullable() })
    .superRefine(({ session, teaching, reference }, context) => {
      const checked = practiceTeachingDetailSchema.safeParse({ version: 1, session, teaching });
      if (!checked.success) for (const issue of checked.error.issues) context.addIssue(issue);
      if (
        reference &&
        (session.type !== "sentence-creation" ||
          session.items.some((item) => item.learningItemDeletedAt))
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "An erased or non-sentence target cannot retain a reference.",
        });
    }),
]);
export const accountDataExportRecordReadSchema = z.union([
  accountDataExportRecordSchema,
  accountDataExportRecordV2Schema,
  accountDataExportRecordV3Schema,
  accountDataExportRecordV4Schema,
]);
export type AccountDataExportRecordRead = z.infer<typeof accountDataExportRecordReadSchema>;

export function projectAccountDataExportRecordForV3(value: AccountDataExportRecordRead) {
  const record = accountDataExportRecordReadSchema.parse(value);
  if (record.recordType === "manifest")
    return accountDataExportRecordV3Schema.parse({ ...record, schemaVersion: 3 });
  if (record.recordType === "practice-session")
    return accountDataExportRecordV3Schema.parse({
      recordType: record.recordType,
      session: record.session,
      teaching: "teaching" in record ? record.teaching : null,
    });
  return accountDataExportRecordV3Schema.parse(record);
}

export function projectAccountDataExportRecordForV2(value: AccountDataExportRecordRead) {
  const record = accountDataExportRecordReadSchema.parse(value);
  if (record.recordType === "manifest")
    return accountDataExportRecordV2Schema.parse({ ...record, schemaVersion: 2 });
  if (record.recordType === "practice-session")
    return accountDataExportRecordV2Schema.parse({
      recordType: record.recordType,
      session: record.session,
    });
  return accountDataExportRecordV2Schema.parse(record);
}

export function projectAccountDataExportRecordForLegacy(
  value: AccountDataExportRecordRead,
): AccountDataExportRecord {
  const record = accountDataExportRecordReadSchema.parse(value);
  if (record.recordType === "manifest")
    return accountDataExportRecordSchema.parse({ ...record, schemaVersion: 1 });
  if (record.recordType === "analysis")
    return accountDataExportRecordSchema.parse({
      ...record,
      analysis: projectAnalysisRecordForLegacy(record.analysis),
    });
  if (record.recordType === "practice-session")
    return accountDataExportRecordSchema.parse({
      recordType: record.recordType,
      session: record.session,
    });
  const native = accountDataExportRecordV2Schema.parse(record);
  if (native.recordType === "extension-query-generation") {
    const { outputContract, ...exported } = native;
    void outputContract;
    return accountDataExportRecordSchema.parse(
      native.state === "completed"
        ? { ...exported, result: projectStoreResultForLegacy(native.result) }
        : exported,
    );
  }
  return accountDataExportRecordSchema.parse(record);
}
