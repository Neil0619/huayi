import type { Clock, SecretSource } from "../security.js";

export class MutableClock implements Clock {
  #current: number;

  constructor(iso: string) {
    this.#current = Date.parse(iso);
  }

  advance(milliseconds: number): void {
    this.#current += milliseconds;
  }

  now(): Date {
    return new Date(this.#current);
  }
}

export class DeterministicSecrets implements SecretSource {
  #counter = 0;

  bytes(length: number): Uint8Array {
    this.#counter += 1;
    return Uint8Array.from({ length }, (_, index) => (this.#counter + index) % 256);
  }
}
