/** Bounded bridge from provider callbacks to an async event consumer. */
export async function* modelEvents<Event, Result>(
  run: (emit: (event: Event) => void) => Promise<Result>,
): AsyncGenerator<Event, Result> {
  const queue: Event[] = [];
  let queuedBytes = 0;
  let wake: (() => void) | undefined;
  let settled = false;
  const completed = run((event) => {
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (queuedBytes + bytes > 2 * 1024 * 1024) return;
    queuedBytes += bytes;
    queue.push(event);
    wake?.();
  })
    .then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    .finally(() => {
      settled = true;
      wake?.();
    });
  while (!settled || queue.length > 0) {
    const next = queue.shift();
    if (next !== undefined) {
      queuedBytes -= new TextEncoder().encode(JSON.stringify(next)).byteLength;
      yield next;
    } else if (!settled)
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
  }
  const outcome = await completed;
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}
