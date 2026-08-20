export class FakeClock {
  readonly #now: Date;

  constructor(now = new Date("2026-08-12T00:00:00.000Z")) {
    this.#now = now;
  }

  now(): Date {
    return new Date(this.#now);
  }
}

export class FakeModel {
  readonly requests: readonly string[] = [];
}

export class FakeMail {
  readonly deliveries: readonly string[] = [];
}

export class TemporaryDatabase {
  readonly kind = "temporary";
}
