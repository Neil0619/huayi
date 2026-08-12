export type VaultErrorCode =
  | "authentication-failed"
  | "invalid-passphrase"
  | "invalid-persisted-data"
  | "invalid-recovery-code"
  | "legacy-migration-required"
  | "locking-unavailable";

const ERROR_MESSAGES: Readonly<Record<VaultErrorCode, string>> = {
  "authentication-failed": "Vault authentication failed.",
  "invalid-passphrase": "The passphrase is invalid.",
  "invalid-persisted-data": "Stored vault data is invalid.",
  "invalid-recovery-code": "The recovery code is invalid.",
  "legacy-migration-required": "Legacy vault migration is required.",
  "locking-unavailable": "Cross-context device vault locking is unavailable.",
};

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "VaultError";
    this.code = code;
  }
}
