import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface Clock {
  now(): Date;
}

export interface SecretSource {
  bytes(length: number): Uint8Array;
}

export const systemClock: Clock = { now: () => new Date() };
export const systemSecrets: SecretSource = { bytes: (length) => randomBytes(length) };

export function opaqueSecret(source: SecretSource, bytes = 32): string {
  return Buffer.from(source.bytes(bytes)).toString("base64url");
}

export function hashSecret(secret: string, pepper: string): string {
  return createHash("sha256").update(pepper).update("\0").update(secret).digest("base64url");
}

export function secretMatches(candidate: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashSecret(candidate, pepper));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}
