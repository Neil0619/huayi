import type {
  StudyCaptureCreateRequest,
  studyCaptureCreateResponseSchema,
  StudyCaptureDetailResponse,
  studyCapturePatchRequestSchema,
  studyCapturePatchResponseSchema,
} from "@huayi/cloud-contracts";
export type SavedCapture = ReturnType<typeof studyCaptureCreateResponseSchema.parse>;
type CapturePatch = ReturnType<typeof studyCapturePatchRequestSchema.parse>;
type PatchedCapture = ReturnType<typeof studyCapturePatchResponseSchema.parse>;
export interface CollectDraft {
  text: string;
  kind: StudyCaptureCreateRequest["kind"];
  title: string;
  context: string;
}
export function sameCollectDraft(value: unknown, snapshot: CollectDraft) {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    value.text === snapshot.text &&
    "kind" in value &&
    value.kind === snapshot.kind &&
    "title" in value &&
    value.title === snapshot.title &&
    "context" in value &&
    value.context === snapshot.context
  );
}
export async function saveCaptureDraft(
  api: {
    createCapture(input: StudyCaptureCreateRequest): Promise<SavedCapture>;
    capture(id: string): Promise<StudyCaptureDetailResponse>;
    patchCapture(id: string, input: CapturePatch): Promise<PatchedCapture>;
  },
  store: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  },
  input: StudyCaptureCreateRequest & { title: string; context: string },
) {
  const snapshot = {
    text: input.sourceText,
    kind: input.kind,
    title: input.title,
    context: input.context,
  };
  const fingerprint = JSON.stringify({ sourceText: input.sourceText.trim(), kind: input.kind });
  const pending = store.get("collect-created");
  const id =
    typeof pending === "object" &&
    pending !== null &&
    "fingerprint" in pending &&
    pending.fingerprint === fingerprint &&
    "id" in pending &&
    typeof pending.id === "string"
      ? pending.id
      : null;
  let capture = id
    ? (await api.capture(id)).capture
    : (await api.createCapture({ sourceText: input.sourceText, kind: input.kind })).capture;
  store.set("collect-created", { fingerprint, id: capture.id });
  if (input.title.trim() || input.context.trim())
    capture = (
      await api.patchCapture(capture.id, {
        expectedRevision: capture.revision,
        ...(input.title.trim() ? { title: input.title.trim() } : {}),
        ...(input.context.trim() ? { userContext: input.context.trim() } : {}),
      })
    ).capture;
  store.remove("collect-created");
  if (sameCollectDraft(store.get("collect-draft"), snapshot)) store.remove("collect-draft");
  return capture;
}
