/** Local Performance entries contain durations only, never original text or account IDs. */
export function measureLearningPresentation(kind: "analysis" | "practice", receivedAt: number) {
  if (typeof requestAnimationFrame !== "function" || typeof performance.measure !== "function")
    return;
  requestAnimationFrame(() => {
    const name = `seen-said:${kind}:increment-to-paint`;
    if (performance.getEntriesByName(name).length >= 100) performance.clearMeasures(name);
    performance.measure(name, { start: receivedAt, end: performance.now() });
  });
}
