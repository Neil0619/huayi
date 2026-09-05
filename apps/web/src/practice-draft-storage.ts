const prefix = "seen-said.practice-draft.v2:";
const ttl = 7 * 86_400_000;

// Only restore after the server has authorized this exact session. Tab storage is
// a short-lived write buffer; the server remains the durable source of truth.
export function readPracticeDraft(id: string, revision: number): string | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(prefix + id) ?? "null");
    if (
      typeof value !== "object" ||
      !value ||
      !("text" in value) ||
      !("revision" in value) ||
      !("at" in value)
    )
      return null;
    return typeof value.text === "string" &&
      value.text.length <= 4000 &&
      typeof value.at === "number" &&
      Date.now() - value.at < ttl &&
      typeof value.revision === "number" &&
      value.revision >= revision
      ? value.text
      : null;
  } catch {
    return null;
  }
}

export function writePracticeDraft(id: string, text: string, revision: number) {
  try {
    const keys = Object.keys(sessionStorage).filter((key) => key.startsWith(prefix));
    for (const key of keys.slice(0, Math.max(0, keys.length - 19)))
      if (key !== prefix + id) sessionStorage.removeItem(key);
    sessionStorage.setItem(prefix + id, JSON.stringify({ text, revision, at: Date.now() }));
  } catch {
    /* Server draft saving still works when tab storage is unavailable. */
  }
}
