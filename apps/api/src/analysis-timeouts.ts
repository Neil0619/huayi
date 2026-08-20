export const ANALYSIS_GENERATION_LEASE_MS = 4 * 60 * 1_000;
export const ANALYSIS_QUOTA_RESERVATION_MS = 5 * 60 * 1_000;

if (ANALYSIS_QUOTA_RESERVATION_MS <= ANALYSIS_GENERATION_LEASE_MS) {
  throw new Error("The quota reservation must outlive the generation lease.");
}
