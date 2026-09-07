import { z } from "zod/v3";
export const DIAGNOSTIC_CONSENT_KEY = "huayi.store.diagnostics.consent";
export const DIAGNOSTIC_OUTBOX_KEY = "huayi.store.diagnostics.outbox";
const consentSchema = z.strictObject({
  version: z.literal(1),
  grantedAt: z.string().datetime(),
  id: z.string().uuid(),
});
export function diagnosticConsentId(value: unknown): string | null {
  const consent = consentSchema.safeParse(value);
  return consent.success ? consent.data.id : null;
}
