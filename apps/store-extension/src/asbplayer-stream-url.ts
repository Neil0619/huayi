export function parseLocalStreamUrl(value: unknown, origin?: string): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  try {
    const url = new URL(value);
    return url.href === value &&
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      Number(url.port) >= 1024 &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      /^\/stream\/[a-f0-9]{64}$/u.test(url.pathname) &&
      (origin === undefined || url.origin === origin)
      ? value
      : null;
  } catch {
    return null;
  }
}
