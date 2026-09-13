import { analysisRecordReadSchema, type AnalysisRecordRead } from "@huayi/cloud-contracts";

/** Reserve mutable server metadata before a new record can enter persistent storage. */
export function validateAnalysisRecordForPersistence(
  value: AnalysisRecordRead,
): AnalysisRecordRead {
  const record = analysisRecordReadSchema.parse(value);
  if (record.modelMetadata.schemaVersion === 3 && "recommendations" in record.result) {
    const instant = "9999-12-31T23:59:59.999Z";
    analysisRecordReadSchema.parse({
      ...record,
      createdAt: record.createdAt.length > instant.length ? record.createdAt : instant,
      archivedAt: (record.archivedAt?.length ?? 0) > instant.length ? record.archivedAt : instant,
      updatedAt: record.updatedAt.length > instant.length ? record.updatedAt : instant,
      revision: Math.max(record.revision, 2_147_483_647),
    });
  }
  return record;
}
