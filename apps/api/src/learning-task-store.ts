import type {
  LearningTaskCommand,
  LearningTaskEvent,
  LearningTaskPayload,
  LearningTaskSnapshot,
  LearningTaskState,
} from "@huayi/cloud-contracts";

export interface LearningTaskLease {
  readonly id: string;
  readonly createdAt: string;
  readonly ownerUserId: string;
  readonly leaseToken: string;
  readonly command: LearningTaskCommand;
}
export interface LearningTaskStore {
  submit(
    ownerUserId: string,
    key: string,
    command: LearningTaskCommand,
  ): Promise<LearningTaskSnapshot>;
  get(ownerUserId: string, id: string): Promise<LearningTaskSnapshot | null>;
  list(ownerUserId: string): Promise<LearningTaskSnapshot[]>;
  events(ownerUserId: string, id: string, cursor: number): Promise<LearningTaskEvent[]>;
  cancel(ownerUserId: string, id: string): Promise<LearningTaskSnapshot | null>;
  claim(): Promise<LearningTaskLease | null>;
  touch(job: LearningTaskLease, dispatch?: boolean): Promise<"running" | "cancelling" | "lost">;
  append(
    job: LearningTaskLease,
    payloads: LearningTaskPayload[],
    timings: Record<string, number>,
  ): Promise<void>;
  finish(
    job: LearningTaskLease,
    outcome: Extract<LearningTaskState, "completed" | "failed" | "cancelled" | "unknown">,
    output: LearningTaskPayload | null,
    error: LearningTaskSnapshot["error"],
  ): Promise<void>;
}
