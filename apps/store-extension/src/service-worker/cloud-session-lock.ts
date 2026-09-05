const queues = new WeakMap<object, Promise<void>>();

/** Order local session transitions shared by pairing and preference refresh. */
export function withCloudSessionLock<T>(vault: object, operation: () => Promise<T>): Promise<T> {
  const next = (queues.get(vault) ?? Promise.resolve()).then(operation);
  queues.set(
    vault,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
