import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { allTenantTables, restrictedTenantTables } from "./tenant-tables.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);

describe("Cloud V1 foundation migration", () => {
  it("creates every documented core table and immutable operational records", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const requiredTables = [
      "invitations",
      "invitation_claims",
      "auth_flows",
      "admin_roles",
      "audit_events",
      "model_price_versions",
      "rate_limit_windows",
      "runtime_controls",
      ...allTenantTables,
    ];

    for (const table of requiredTables) {
      expect(sql).toMatch(new RegExp(`create table ${table}\\b`, "iu"));
    }
    expect(sql).toContain("prevent_usage_ledger_mutation");
    expect(sql).toContain("current_setting('huayi.account_deletion', true) = 'on'");
    expect(sql).toContain("prevent_model_price_mutation");
    expect(sql).toContain("review_state IN ('pendingReview', 'reviewed')");
    expect(sql).toContain("last_rating IN ('forgot', 'effortful', 'mastered')");
    expect(sql).toContain("rating IN ('forgot', 'effortful', 'mastered')");
    expect(sql).toMatch(/create table learning_items[\s\S]*?deleted_at timestamptz/iu);
    expect(sql).toMatch(
      /deleted_at is not null[\s\S]*?canonical_key is null[\s\S]*?content is null/iu,
    );
    expect(sql).toMatch(/create table context_observations[\s\S]*?source_title text/iu);
  });

  it("forces RLS for every tenant table and uses a NO BYPASSRLS business role", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const normalizedSql = sql.toLowerCase();

    expect(sql).toMatch(/create role huayi_business[^;]*nobypassrls/iu);
    expect(sql).toMatch(/create role huayi_runtime[^;]*nologin[^;]*noinherit[^;]*nobypassrls/iu);
    expect(sql).toContain("GRANT huayi_business, huayi_context_setter TO huayi_runtime");
    for (const table of allTenantTables) {
      expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`, "iu"));
      expect(sql).toMatch(new RegExp(`alter table ${table} force row level security`, "iu"));
      expect(sql).toMatch(new RegExp(`create policy ${table}_owner`, "iu"));
      expect(sql).toMatch(
        new RegExp(`create policy ${table}_owner[\\s\\S]*?using[\\s\\S]*?with check`, "iu"),
      );
    }
    expect(normalizedSql).toContain("huayi_private.current_owner_user_id()");
    expect(normalizedSql).toContain("pg_backend_pid()");
    expect(normalizedSql).toContain("txid_current()");
    expect(normalizedSql).toContain("revoke all on function huayi_private.set_owner_context(uuid)");
    expect(normalizedSql).toContain(
      "grant execute on function huayi_private.set_owner_context(uuid)",
    );
    expect(sql).not.toMatch(/grant execute[^;]*set_owner_context[^;]*huayi_business/iu);
    expect(normalizedSql).toContain("delete from huayi_private.transaction_owner_context");
  });

  it("enforces same-owner foreign keys for tenant relationships", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const relationships = [
      ["analysis_candidates", "analysis_id", "analysis_records"],
      ["source_examples", "learning_item_id", "learning_items"],
      ["learning_item_tags", "learning_item_id", "learning_items"],
      ["learning_item_tags", "tag_id", "tags"],
      ["schedule_states", "learning_item_id", "learning_items"],
      ["context_observations", "word_entry_id", "word_entries"],
      ["external_wordbook_items", "job_id", "external_wordbook_jobs"],
      ["external_wordbook_items", "word_entry_id", "word_entries"],
      ["practice_session_items", "session_id", "practice_sessions"],
      ["practice_session_items", "learning_item_id", "learning_items"],
      ["practice_turns", "session_id", "practice_sessions"],
      ["practice_attempts", "session_id", "practice_sessions"],
      ["practice_generation_tasks", "session_id", "practice_sessions"],
    ] as const;

    for (const [table, idColumn, parent] of relationships) {
      expect(sql).toMatch(
        new RegExp(
          `alter table ${table}[\\s\\S]*?foreign key \\(${idColumn}, owner_user_id\\)[\\s\\S]*?references ${parent}`,
          "iu",
        ),
      );
    }
  });

  it("provides atomic invitation, pairing, and quota transaction functions", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("claim_invitation");
    expect(sql).toContain("finalize_invitation");
    expect(sql).toContain("create_extension_pairing");
    expect(sql).toContain("approve_extension_pairing");
    expect(sql).toContain("exchange_extension_pairing");
    expect(sql).toMatch(
      /create function exchange_extension_pairing[\s\S]*?returns table\([\s\S]*?preferences_updated_at timestamptz/iu,
    );
    expect(sql).toMatch(
      /select \* into profile_snapshot from public\.user_profiles[\s\S]*?if not found then raise exception 'profile unavailable'/iu,
    );
    expect(sql).toContain("revoke_current_extension_session");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("reserve_quota");
    expect(sql).toContain("settle_quota_reservation");
    expect(sql).toContain("require_model_price_version");
    expect(sql).toContain("require_analysis_lease");
    expect(sql).toContain("mutate_analysis_record");
    expect(sql).toContain("begin_idempotent_write");
    expect(sql).toMatch(
      /revoke all on function replay_account_deletion\(text, text, text\)[\s\S]*?from public, huayi_business/iu,
    );
    expect(sql).toMatch(
      /grant execute on function replay_account_deletion\(text, text, text\)[\s\S]*?to huayi_context_setter/iu,
    );
    expect(sql).toMatch(
      /revoke all on function huayi_private\.analysis_public_record\(uuid\) from public, huayi_business/iu,
    );
    expect(sql).toMatch(
      /owner_analysis_public_record[\s\S]*?records\.owner_user_id=account_owner_user_id[\s\S]*?account_owner_user_id=huayi_private\.current_owner_user_id\(\)/iu,
    );
    expect(sql).toMatch(
      /grant execute on function huayi_private\.owner_analysis_public_record\(uuid, uuid\)[\s\S]*?to huayi_context_setter/iu,
    );
    expect(sql).toMatch(
      /revoke all on function begin_idempotent_write\(uuid, text, text, text\)[\s\S]*?from public, huayi_business/iu,
    );
    expect(sql).toMatch(
      /revoke all on function revoke_current_extension_session\(text\)[\s\S]*?from public, huayi_business/iu,
    );
    expect(sql).toContain("release_expired_quota_reservations");
    expect(sql).toContain("replace_quota_grant");
    expect(sql).toContain("consume_rate_limit");
    expect(sql).toContain("create_auth_flow");
    expect(sql).toContain("consume_auth_flow");
    expect(sql).toContain("complete_auth_flow");
    expect(sql).toContain("authorize_sign_in_method");
    expect(sql).toMatch(/grant select on account_sign_in_methods to huayi_business/iu);
    const tenantMutationGrant = sql.match(
      /grant select, insert, update, delete on([\s\S]*?)to huayi_business;/iu,
    )?.[1];
    expect(tenantMutationGrant).not.toContain("account_sign_in_methods");
    expect(sql).toContain("bind_auth_identity");
    expect(sql).toContain("create_web_session");
    expect(sql).toContain("authenticate_web_session");
    expect(sql).toContain("prepare_password_reauthentication");
    expect(sql).toContain("require_recent_authentication");
    expect(sql).toContain("rotate_password_reauthenticated_session");
    expect(sql).toContain("create_google_reauthentication");
    expect(sql).toContain("continue_google_reauthentication");
    expect(sql).toContain("complete_google_reauthentication");
    expect(sql).toContain("claim_google_link_continuation");
    expect(sql).toContain("complete_google_link");
    expect(sql).toContain("claim_password_link");
    expect(sql).toContain("complete_password_link");
    expect(sql).toContain("request_password_recovery");
    expect(sql).toContain("claim_password_recovery_dispatch");
    expect(sql).toContain("complete_password_recovery_callback");
    expect(sql).toContain("claim_password_recovery_completion");
    expect(sql).toContain("complete_password_recovery");
    expect(sql).toContain("cleanup_password_recovery_flows");
    expect(sql).toContain("claim_security_notification");
    expect(sql).toContain("complete_security_notification");
    expect(sql).toContain("retry_security_notification");
    for (const table of restrictedTenantTables) {
      expect(sql).toMatch(
        new RegExp(`revoke all on[\\s\\S]*?${table}[\\s\\S]*?from public, huayi_business`, "iu"),
      );
    }
    expect(sql).toMatch(
      /revoke all on function rotate_password_reauthenticated_session[\s\S]*?from public, huayi_business/iu,
    );
    expect(sql).toContain("name = 'model_kill_switch' AND enabled");
    expect(sql).toContain("public.release_expired_quota_reservations(account_user_id)");
    expect(sql).toMatch(/grant select on\s+quota_grants, quota_reservations, usage_ledger/iu);
    expect(sql).not.toMatch(/grant select, insert[^;]*usage_ledger/iu);
  });
});
