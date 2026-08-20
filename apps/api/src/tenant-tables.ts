export const tenantTables = [
  "user_profiles",
  "account_sign_in_methods",
  "web_sessions",
  "account_data_export_jobs",
  "extension_sessions",
  "extension_pairings",
  "study_captures",
  "analysis_records",
  "analysis_candidates",
  "idempotency_records",
  "analysis_requests",
  "extension_query_generations",
  "learning_items",
  "source_examples",
  "tags",
  "learning_item_tags",
  "schedule_states",
  "word_entries",
  "context_observations",
  "external_wordbook_jobs",
  "external_wordbook_items",
  "practice_sessions",
  "practice_session_items",
  "practice_turns",
  "practice_attempts",
  "practice_generation_tasks",
  "quota_grants",
  "quota_reservations",
  "usage_ledger",
] as const;

export const restrictedTenantTables = [
  "learning_duplicate_suggestion_requests",
  "password_recovery_flows",
  "security_notification_outbox",
] as const;

export const allTenantTables = [...tenantTables, ...restrictedTenantTables] as const;

export type TenantTable = (typeof tenantTables)[number];
