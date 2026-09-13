import type {
  LearningTaskCommandRead,
  LearningTaskEventRead,
  LearningTaskPayloadRead,
  LearningTaskSnapshotRead,
  LearningTaskState,
} from "@huayi/cloud-contracts";

export interface LearningTaskLease {
  readonly id: string;
  readonly createdAt: string;
  readonly ownerUserId: string;
  readonly leaseToken: string;
  readonly command: LearningTaskCommandRead;
  readonly generationSnapshot?: unknown;
}
export interface LearningTaskStore {
  submit(
    ownerUserId: string,
    key: string,
    command: LearningTaskCommandRead,
  ): Promise<LearningTaskSnapshotRead>;
  get(ownerUserId: string, id: string): Promise<LearningTaskSnapshotRead | null>;
  list(ownerUserId: string): Promise<LearningTaskSnapshotRead[]>;
  events(ownerUserId: string, id: string, cursor: number): Promise<LearningTaskEventRead[]>;
  cancel(ownerUserId: string, id: string): Promise<LearningTaskSnapshotRead | null>;
  claim(): Promise<LearningTaskLease | null>;
  touch(job: LearningTaskLease, dispatch?: boolean): Promise<"running" | "cancelling" | "lost">;
  append(
    job: LearningTaskLease,
    payloads: LearningTaskPayloadRead[],
    timings: Record<string, number>,
  ): Promise<void>;
  finish(
    job: LearningTaskLease,
    outcome: Extract<LearningTaskState, "completed" | "failed" | "cancelled" | "unknown">,
    output: LearningTaskPayloadRead | null,
    error: LearningTaskSnapshotRead["error"],
  ): Promise<void>;
}
