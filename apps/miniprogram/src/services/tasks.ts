import Taro from "@tarojs/taro";
import {
  createLearningTaskSseDecoder,
  learningTaskCommandSchema,
  learningTaskSnapshotSchema,
  learningTaskRoutes,
  type LearningTaskCommand,
} from "@huayi/cloud-contracts";
import { apiOrigin } from "./http";
import { request, session } from "./session";
import { localStore, mutationKey } from "./storage";
import { createUtf8Decoder } from "./utf8";
import { createTaskWatcher } from "./task-watch";
import { taskLifecycle } from "./task-lifecycle";
import { MiniError } from "./errors";

const taskPath = (id: string) => `${learningTaskRoutes.submit}/${encodeURIComponent(id)}`;
export const watchTask = createTaskWatcher({
  lifecycle: taskLifecycle,
  delay: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
  read: (id, cursor) => request(`${taskPath(id)}/events?cursor=${cursor}`),
  stream(id, cursor, onFrame, onDone) {
    const decoder = createUtf8Decoder();
    const frames = createLearningTaskSseDecoder(id, cursor);
    let aborted = false;
    let gotChunks = false;
    let abort: () => void = () => undefined;
    const epoch = session.getSnapshot().epoch;
    void session
      .ensure()
      .then((token) => {
        if (aborted) return;
        const task = Taro.request<ArrayBuffer>({
          url: `${apiOrigin()}${taskPath(id)}/events?cursor=${cursor}`,
          method: "GET",
          enableChunked: true,
          responseType: "arraybuffer",
          timeout: 25_000,
          header: { Accept: "text/event-stream", Authorization: `HuayiMiniProgram ${token}` },
        });
        abort = () => task.abort();
        if (typeof task.onChunkReceived !== "function") {
          task.abort();
          throw new MiniError("network_error");
        }
        task.onChunkReceived(({ data }) => {
          if (aborted || epoch !== session.getSnapshot().epoch) return;
          try {
            gotChunks = true;
            for (const frame of frames.push(decoder.push(new Uint8Array(data)))) onFrame(frame);
          } catch (error) {
            aborted = true;
            task.abort();
            onDone(error);
          }
        });
        void task.then(
          (response) => {
            if (aborted) return;
            try {
              if (response.statusCode !== 200 || !gotChunks)
                throw new MiniError(
                  response.statusCode === 401 ? "authentication_required" : "network_error",
                );
              decoder.finish();
              frames.finish();
              onDone();
            } catch (error) {
              onDone(error);
            }
          },
          () => {
            if (!aborted) onDone(new MiniError("network_error"));
          },
        );
      })
      .catch((error) => {
        if (!aborted) onDone(error);
      });
    return {
      abort() {
        aborted = true;
        abort();
      },
    };
  },
});
export async function submitTask(scope: string, command: LearningTaskCommand) {
  const input = learningTaskCommandSchema.parse(command);
  const key = mutationKey(`task:${scope}`, input);
  const result = learningTaskSnapshotSchema.parse(
    await request(learningTaskRoutes.submit, {
      method: "POST",
      data: input,
      headers: { "Idempotency-Key": key },
    }),
  );
  localStore.set(`task:${scope}`, result.id);
  return result;
}
export async function cancelTask(id: string) {
  return learningTaskSnapshotSchema.parse(
    await request(`${taskPath(id)}/cancel`, { method: "POST" }),
  );
}
export async function listTasks() {
  const value = await request(learningTaskRoutes.list);
  if (!Array.isArray(value)) throw new MiniError("invalid_response");
  return value.map((item) => learningTaskSnapshotSchema.parse(item));
}
