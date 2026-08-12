import {
  createInitialWordbookState,
  wordbookPersistentStateSchema,
  type WordbookPersistentState,
  type WordbookStateStore,
} from "./wordbook-state.js";

export function createMemoryWordbookStateStore(
  initialState: WordbookPersistentState = createInitialWordbookState("1970-01-01T00:00:00.000Z"),
): WordbookStateStore {
  let revision = 0;
  let state = structuredClone(wordbookPersistentStateSchema.parse(initialState));
  return {
    async compareAndSwap(expectedRevision, candidate) {
      if (revision !== expectedRevision) return false;
      state = structuredClone(wordbookPersistentStateSchema.parse(candidate));
      revision += 1;
      return true;
    },
    async read() {
      return { revision, state: structuredClone(state) };
    },
  };
}
