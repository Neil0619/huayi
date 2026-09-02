export function randomUrlSafeId(cryptoRef: Pick<Crypto, "getRandomValues">): string {
  const bytes = cryptoRef.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
