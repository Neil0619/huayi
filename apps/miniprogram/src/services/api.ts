import {
  wordCatalogListSchema,
  wordCatalogDetailSchema,
  wordCatalogEntrySchema,
} from "@huayi/cloud-contracts";
import {
  analysisHttpRoutes,
  analysisRecordSchema,
  analysisHistoryResponseSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  studyCaptureCreateRequestSchema,
  studyCaptureCreateResponseSchema,
  studyCaptureDetailResponseSchema,
  studyCaptureListResponseSchema,
  studyCapturePatchRequestSchema,
  studyCapturePatchResponseSchema,
  studyCaptureListQuerySchema,
  learningItemListResponseSchema,
  learningItemDetailResponseSchema,
  createLearningItemRequestSchema,
  patchLearningItemRequestSchema,
  upsertWordRequestSchema,
  upsertWordResponseSchema,
  patchWordEntryRequestSchema,
  patchWordEntryResponseSchema,
  dailyPracticeQueueResponseSchema,
  practiceSessionResponseSchema,
  practiceHistoryListResponseSchema,
  practiceHistoryDetailResponseSchema,
  practiceHttpRoutesV2,
  practiceWorkspaceStartSchema,
  practiceWorkspaceControlSchema,
  practiceWorkspaceDraftSchema,
  practiceRatingsRequestSchema,
  accountPreferencesResponseSchema,
  accountPreferencesRequestSchema,
  quotaSummarySchema,
  wordbookJobListResponseSchema,
  accountDataExportJobResourceSchema,
  currentAccountDataExportResponseSchema,
  accountDataRightsHttpRoutes,
  identityHttpRoutes,
  externalWordbookHttpRoutes,
  type ConfirmCandidatesRequest,
  type PracticeWorkspaceStart,
  type PracticeWorkspaceControl,
  type PracticeWorkspaceDraft,
} from "@huayi/cloud-contracts";
import { request } from "./session";
import { mutationKey, writeIntents } from "./storage";

export function route(template: string, id: string) {
  return template.replace(":id", encodeURIComponent(id));
}
export async function read<T>(
  path: string,
  schema: { parse(value: unknown): T },
  query: Record<string, unknown> = {},
) {
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return schema.parse(await request(path + (params ? `?${params}` : "")));
}
export async function write<T>(
  path: string,
  schema: { parse(value: unknown): T },
  input: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
  revision?: number,
) {
  const key = mutationKey(path, input);
  const result = schema.parse(
    await request(path, {
      method,
      data: input,
      headers: {
        "Idempotency-Key": key,
        ...(revision === undefined ? {} : { "X-Huayi-Revision": `"${revision}"` }),
      },
    }),
  );
  writeIntents.acknowledge(path, key);
  return result;
}
export const learningApi = {
  captures: (query: Record<string, unknown>) =>
    read(
      "/v1/study-captures",
      studyCaptureListResponseSchema,
      studyCaptureListQuerySchema.parse(query),
    ),
  capture: (id: string) =>
    read(`/v1/study-captures/${encodeURIComponent(id)}`, studyCaptureDetailResponseSchema),
  createCapture: (input: unknown) =>
    write(
      "/v2/study-captures",
      studyCaptureCreateResponseSchema,
      studyCaptureCreateRequestSchema.parse(input),
    ),
  patchCapture: (id: string, input: ReturnType<typeof studyCapturePatchRequestSchema.parse>) =>
    write(
      `/v1/study-captures/${encodeURIComponent(id)}`,
      studyCapturePatchResponseSchema,
      studyCapturePatchRequestSchema.parse(input),
      "PATCH",
      input.expectedRevision,
    ),
  analysis: (id: string) => read(route(analysisHttpRoutes.detail, id), analysisRecordSchema),
  analyses: (query: Record<string, unknown>) =>
    read(analysisHttpRoutes.history, analysisHistoryResponseSchema, query),
  confirm: (id: string, input: ConfirmCandidatesRequest) =>
    write(
      route(analysisHttpRoutes.confirmCandidates, id),
      confirmCandidatesResponseSchema,
      confirmCandidatesRequestSchema.parse(input),
      "POST",
      input.analysisRevision,
    ),
  items: (query: Record<string, unknown>) =>
    read("/v1/learning-items", learningItemListResponseSchema, query),
  item: (id: string) =>
    read(`/v1/learning-items/${encodeURIComponent(id)}`, learningItemDetailResponseSchema),
  createItem: (input: unknown) =>
    write(
      "/v1/learning-items",
      learningItemDetailResponseSchema,
      createLearningItemRequestSchema.parse(input),
    ),
  editItem: (id: string, input: ReturnType<typeof patchLearningItemRequestSchema.parse>) =>
    write(
      `/v1/learning-items/${encodeURIComponent(id)}`,
      learningItemDetailResponseSchema,
      patchLearningItemRequestSchema.parse(input),
      "PATCH",
      input.expectedRevision,
    ),
  archiveItem: (id: string, revision: number, restore = false) =>
    write(
      `/v1/learning-items/${encodeURIComponent(id)}/${restore ? "restore" : "archive"}`,
      learningItemDetailResponseSchema,
      { expectedRevision: revision },
      "POST",
      revision,
    ),
  words: (query: Record<string, unknown>) => read("/v2/words", wordCatalogListSchema, query),
  word: (id: string, contextCursor?: string) =>
    read(`/v2/words/${encodeURIComponent(id)}`, wordCatalogDetailSchema, {
      contextCursor,
      contextLimit: 20,
    }),
  archiveWord: (id: string, revision: number, archived: boolean) =>
    write(
      `/v2/words/${encodeURIComponent(id)}/archive`,
      wordCatalogEntrySchema,
      { expectedRevision: revision, archived },
      "POST",
      revision,
    ),
  createWord: (input: unknown) =>
    write("/v1/words", upsertWordResponseSchema, upsertWordRequestSchema.parse(input)),
  editWord: (id: string, revision: number, notes: string) =>
    write(
      `/v1/words/${encodeURIComponent(id)}`,
      patchWordEntryResponseSchema,
      patchWordEntryRequestSchema.parse({
        expectedRevision: revision,
        notes: notes.trim() || null,
      }),
      "PATCH",
      revision,
    ),
  daily: () => read(practiceHttpRoutesV2.dailyQueue, dailyPracticeQueueResponseSchema),
  startPractice: (input: PracticeWorkspaceStart) =>
    write(
      "/v2/practice-workspace/start",
      practiceSessionResponseSchema,
      practiceWorkspaceStartSchema.parse(input),
    ),
  practice: (id: string) =>
    read(`/v2/practice-workspace/${encodeURIComponent(id)}`, practiceSessionResponseSchema),
  control: (id: string, input: PracticeWorkspaceControl) =>
    write(
      `/v2/practice-workspace/${encodeURIComponent(id)}/control`,
      practiceSessionResponseSchema,
      practiceWorkspaceControlSchema.parse(input),
    ),
  draft: (id: string, input: PracticeWorkspaceDraft) =>
    write(
      `/v2/practice-workspace/${encodeURIComponent(id)}/draft`,
      practiceSessionResponseSchema,
      practiceWorkspaceDraftSchema.parse(input),
    ),
  rate: (id: string, input: ReturnType<typeof practiceRatingsRequestSchema.parse>) =>
    write(
      route(practiceHttpRoutesV2.rate, id),
      practiceSessionResponseSchema,
      practiceRatingsRequestSchema.parse(input),
      "POST",
      input.expectedRevision,
    ),
  history: (query: Record<string, unknown>) =>
    read(practiceHttpRoutesV2.historyList, practiceHistoryListResponseSchema, query),
  historyDetail: (id: string) =>
    read(route(practiceHttpRoutesV2.historyDetail, id), practiceHistoryDetailResponseSchema),
  preferences: () => read("/v1/account/preferences", accountPreferencesResponseSchema),
  setPreferences: (input: ReturnType<typeof accountPreferencesRequestSchema.parse>) =>
    write(
      "/v1/account/preferences",
      accountPreferencesResponseSchema,
      accountPreferencesRequestSchema.parse(input),
      "PATCH",
    ),
  quota: () => read(identityHttpRoutes.quota, quotaSummarySchema),
  wordbookJobs: () =>
    read(externalWordbookHttpRoutes.list, wordbookJobListResponseSchema, { limit: 20 }),
  currentExport: () =>
    read(accountDataRightsHttpRoutes.currentExport, currentAccountDataExportResponseSchema),
  export: () =>
    write(accountDataRightsHttpRoutes.createExport, accountDataExportJobResourceSchema, {}),
};
