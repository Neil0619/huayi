export type LexiconErrorCode =
  "concurrent-modification" | "data-corrupt" | "incompatible-schema" | "storage-failure";

export class LexiconError extends Error {
  readonly code: LexiconErrorCode;

  constructor(code: LexiconErrorCode) {
    super(code);
    this.name = "LexiconError";
    this.code = code;
  }
}
