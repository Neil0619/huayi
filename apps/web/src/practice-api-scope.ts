import type { PracticePageApi } from "./practice-page-api.js";

/** A mounted account surface owns every continuation, including subsequent writes. */
export function createPracticeApiScope(source: PracticePageApi) {
  let epoch = 0;
  let active = true;
  let controller = new AbortController();
  const bind = (): PracticePageApi => ({ ...source, ...source.withSignal?.(controller.signal) });
  let transport = bind();
  const required = <T>(part: T | undefined) => {
    if (!part) throw new Error("Practice capability unavailable.");
    return part;
  };
  const checkpoint = () => {
    const captured = epoch;
    return () => active && captured === epoch;
  };
  const assert = (current: () => boolean) => {
    if (!current()) throw new DOMException("Practice surface changed.", "AbortError");
  };
  const wrap =
    <A extends unknown[], R>(select: (api: PracticePageApi) => (...args: A) => Promise<R>) =>
    async (...args: A) => {
      const current = checkpoint();
      assert(current);
      const result = await select(transport)(...args);
      assert(current);
      return result;
    };
  const api: PracticePageApi = {
    ...source,
    dailyQueue: wrap((api) => api.dailyQueue),
    getLearningItem: wrap((api) => api.getLearningItem),
    startSentence: wrap((api) => api.startSentence),
    submitAttempt: wrap((api) => api.submitAttempt),
    retryFeedback: wrap((api) => api.retryFeedback),
    rate: wrap((api) => api.rate),
    startDialogue: wrap((api) => api.startDialogue),
    submitTurn: wrap((api) => api.submitTurn),
    retryAssistant: wrap((api) => api.retryAssistant),
    finish: wrap((api) => api.finish),
    ...(source.workspace
      ? {
          workspace: {
            start: wrap((api) => required(api.workspace).start),
            get: wrap((api) => required(api.workspace).get),
            list: wrap((api) => required(api.workspace).list),
            draft: wrap((api) => required(api.workspace).draft),
            control: wrap((api) => required(api.workspace).control),
          },
        }
      : {}),
    ...(source.teaching
      ? {
          teaching: {
            get: wrap((api) => required(api.teaching).get),
            act: wrap((api) => required(api.teaching).act),
          },
        }
      : {}),
    ...(source.reference
      ? {
          reference: {
            get: wrap((api) => required(api.reference).get),
            reveal: wrap((api) => required(api.reference).reveal),
          },
        }
      : {}),
    ...(source.tasks
      ? {
          tasks: {
            ...source.tasks,
            submit: wrap((api) => required(api.tasks).submit),
            list: wrap((api) => required(api.tasks).list),
            get: wrap((api) => required(api.tasks).get),
            cancel: wrap((api) => required(api.tasks).cancel),
            async *watch(...args: Parameters<NonNullable<PracticePageApi["tasks"]>["watch"]>) {
              const current = checkpoint();
              assert(current);
              const tasks = required(transport.tasks);
              for await (const event of tasks.watch(...args)) {
                assert(current);
                yield event;
              }
              assert(current);
            },
          },
        }
      : {}),
  };
  return {
    api,
    checkpoint,
    activate() {
      if (!active) {
        controller = new AbortController();
        transport = bind();
        active = true;
      }
    },
    deactivate() {
      active = false;
      epoch += 1;
      controller.abort();
    },
  };
}
