function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pendingR3c(snapshot) {
  return (
    record(snapshot) &&
    snapshot.r3c_total === "1" &&
    snapshot.r3c_pending === "1" &&
    snapshot.r3c_sending === "0" &&
    snapshot.r3c_sent === "0" &&
    snapshot.r3c_failed === "0" &&
    snapshot.r3c_dead_letter === "0" &&
    snapshot.r3c_claimable === "1" &&
    snapshot.r3c_overdue_nonterminal === "0" &&
    snapshot.r3c_max_attempts === "0" &&
    snapshot.r3c_contract_exact === "t"
  );
}

export function emptyR3c(snapshot) {
  return (
    record(snapshot) &&
    snapshot.r3c_total === "0" &&
    snapshot.r3c_pending === "0" &&
    snapshot.r3c_sending === "0" &&
    snapshot.r3c_sent === "0" &&
    snapshot.r3c_failed === "0" &&
    snapshot.r3c_dead_letter === "0" &&
    snapshot.r3c_claimable === "0" &&
    snapshot.r3c_overdue_nonterminal === "0" &&
    snapshot.r3c_max_attempts === "0" &&
    snapshot.r3c_contract_exact === "t"
  );
}

export function sentR3c(snapshot) {
  return (
    record(snapshot) &&
    snapshot.r3c_total === "1" &&
    snapshot.r3c_pending === "0" &&
    snapshot.r3c_sending === "0" &&
    snapshot.r3c_sent === "1" &&
    snapshot.r3c_failed === "0" &&
    snapshot.r3c_dead_letter === "0" &&
    snapshot.r3c_claimable === "0" &&
    snapshot.r3c_overdue_nonterminal === "0" &&
    /^(?:[1-8])$/u.test(snapshot.r3c_max_attempts) &&
    snapshot.r3c_contract_exact === "t"
  );
}

export function claimablePasswordRecovery(snapshot) {
  return (
    record(snapshot) &&
    snapshot.password_recovery_open_total === "1" &&
    snapshot.password_recovery_claimable === "1" &&
    snapshot.password_recovery_sent === "0" &&
    snapshot.password_recovery_ambiguous === "0"
  );
}

export function sentPasswordRecovery(snapshot) {
  return (
    record(snapshot) &&
    snapshot.password_recovery_open_total === "1" &&
    snapshot.password_recovery_claimable === "0" &&
    snapshot.password_recovery_sent === "1" &&
    snapshot.password_recovery_ambiguous === "0"
  );
}

export function exactCronAbsent(status) {
  return (
    record(status) &&
    status.cron_installation_state === "absent" &&
    status.cron_fixed_jobs_count === "0" &&
    status.cron_unmanaged_jobs_count === "0" &&
    status.cron_jobs_exact === "f" &&
    status.cron_function_contract_exact === "f"
  );
}
