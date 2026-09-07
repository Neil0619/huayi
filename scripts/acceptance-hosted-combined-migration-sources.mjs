import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { hostedCombinedMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { loadHostedImportantBatchRebuildSources } from "./acceptance-hosted-important-batch-rebuild-sources.mjs";

// Pinned reviewed source set from tree 94c6a89b84b8c0e98304a15bf7ed83ed5d3c52fb.
// This tree is provenance only; live evidence must bind a real clean pushed commit.
export const hostedCombinedMigrationSourcePins = Object.freeze(
  [
    {
      apiFile: "0001-cloud-v1-foundation.sql",
      mirrorFile: "20260821000000_cloud_v1_foundation.sql",
      sha256: "be688dad39b5f8aee740425833b10e160fe264a732c7f6a8ffbb10772a013a34",
    },
    {
      apiFile: "0002-account-default-quota.sql",
      mirrorFile: "20260821010000_account_default_quota.sql",
      sha256: "e9e709ed424b81f37544ad85c29e231fe5fb03ed5bdc4648b8c5ae960a91c746",
    },
    {
      apiFile: "0003-password-auth-callback-method.sql",
      mirrorFile: "20260821020000_password_auth_callback_method.sql",
      sha256: "3dc542819b1537ef012b2962cc5a27b2a0e5995b4d151ddd2517a1e679723dd2",
    },
    {
      apiFile: "0004-analysis-reservation-fallback.sql",
      mirrorFile: "20260821030000_analysis_reservation_fallback.sql",
      sha256: "429deb32feb1abd1ecc252af59dc0a3859be5df28a71b2a232e358a117e05f95",
    },
    {
      apiFile: "0005-practice-generation-settlement.sql",
      mirrorFile: "20260821040000_practice_generation_settlement.sql",
      sha256: "06f7ae1c4195f3fb4a2298071db4bc0f78ff0e6f0555013ad678af5ac86fb5db",
    },
    {
      apiFile: "0006-owner-scoped-analysis-export.sql",
      mirrorFile: "20260821050000_owner_scoped_analysis_export.sql",
      sha256: "615a6ceeedac8de45d6a143cf2bca8261f28f4c8826c47c9be14cc19bbb37171",
    },
    {
      apiFile: "0007-analysis-export-owner-wrapper.sql",
      mirrorFile: "20260821060000_analysis_export_owner_wrapper.sql",
      sha256: "17fe2426cbedae0fcd283389046728524687c85c7f083ecd14e9598be41cccf9",
    },
    {
      apiFile: "0008-extension-pairing-atomic-snapshot.sql",
      mirrorFile: "20260821070000_extension_pairing_atomic_snapshot.sql",
      sha256: "b916c0e44df533933b0a970fbd367295997892bf7615a3f6332fff79af4e4cf8",
    },
    {
      apiFile: "0009-account-deletion-replay.sql",
      mirrorFile: "20260821080000_account_deletion_replay.sql",
      sha256: "8449c8c9564fc98aec4f8668b51d740779a3d554230bb62828178b99ed05fd32",
    },
    {
      apiFile: "0010-quota-lifecycle-and-model-rate-limit.sql",
      mirrorFile: "20260822010000_quota_lifecycle_and_model_rate_limit.sql",
      sha256: "15c6044eb2f3c8af89c96a366867e581f52d2aa18d7b986b414ccd408314dbb4",
    },
    {
      apiFile: "0011-security-notification-delivery.sql",
      mirrorFile: "20260822020000_security_notification_delivery.sql",
      sha256: "064216dc1c699891287c85b504b2170ad577099d8ba9beaf75e78bc709ef3ba8",
    },
    {
      apiFile: "0012-first-operator-bootstrap.sql",
      mirrorFile: "20260822030000_first_operator_bootstrap.sql",
      sha256: "9163ff91dca038d8b9d362e0b8d8c0d47320a3f28b36f673eb782548c4be727d",
    },
    {
      apiFile: "0013-password-signup-interruption-recovery.sql",
      mirrorFile: "20260823010000_password_signup_interruption_recovery.sql",
      sha256: "660246230ace35c2b4f17d09fdf8e187f7271886bd606c9f50a36d9b08ecbcd6",
    },
    {
      apiFile: "0014-password-signup-otp-resend.sql",
      mirrorFile: "20260824010000_password_signup_otp_resend.sql",
      sha256: "2223d48e68a3d75f02a6fbc200d892ea347b2cac72680a48fd5dd56db7297faf",
    },
    {
      apiFile: "0015-public-function-acl-hardening.sql",
      mirrorFile: "20260825010000_public_function_acl_hardening.sql",
      sha256: "a9f17524dfecb4bbf47ffc954e56bb1d3629fe2cd175a0b17af5b47b32d98634",
    },
    {
      apiFile: "0016-hosted-deepseek-acceptance-authority.sql",
      mirrorFile: "20260827010000_hosted_deepseek_acceptance_authority.sql",
      sha256: "ac8dd4521e551be4b27002732ba924133d7f97e6f9a2f92f547d178a297d211c",
    },
    {
      apiFile: "0017-hosted-deepseek-acceptance-retention-scrub.sql",
      mirrorFile: "20260827020000_hosted_deepseek_acceptance_retention_scrub.sql",
      sha256: "295e640f619bc14137e7f19c78df2bc76cb47259fc23e5cf7b1bffb3d073d9d1",
    },
    {
      apiFile: "0018-hosted-deepseek-acceptance-status.sql",
      mirrorFile: "20260827030000_hosted_deepseek_acceptance_status.sql",
      sha256: "b9bc2ac9c1fc96082ffcc45ad22349faba589a532dbaa9b9e15aac29702d5703",
    },
    {
      apiFile: "0019-hosted-deepseek-acceptance-effective-fuse.sql",
      mirrorFile: "20260827040000_hosted_deepseek_acceptance_effective_fuse.sql",
      sha256: "f1d0599365b1437556673e9b37495b46653a053831487affd3a085303b8f7b56",
    },
    {
      apiFile: "0020-hosted-deepseek-acceptance-authority-mutations.sql",
      mirrorFile: "20260827050000_hosted_deepseek_acceptance_authority_mutations.sql",
      sha256: "d4dbee773244985c9e5a3f55bcbb7f2e9ce03cc952342b82cbff0a775c7ba9db",
    },
    {
      apiFile: "0021-hosted-deepseek-acceptance-evidence.sql",
      mirrorFile: "20260827060000_hosted_deepseek_acceptance_evidence.sql",
      sha256: "1be7d36eb541a488e19b13a44b9ba3b3acf89165f9fb0f8f8c108a00d2e98d84",
    },
    {
      apiFile: "0022-password-signup-expired-invitation-recovery.sql",
      mirrorFile: "20260828010000_password_signup_expired_invitation_recovery.sql",
      sha256: "a491e56ba3905ada4f5eb50ce152a08b6f534bc4f479de6fca6601a977ddd5d5",
    },
    {
      apiFile: "0023-invitation-token-recovery.sql",
      mirrorFile: "20260831010000_invitation_token_recovery.sql",
      sha256: "1530fcbe8abc53d08abc246d4556ef5824378b5b066a2ef7906ca07b01689956",
    },
    {
      apiFile: "0024-durable-learning-tasks.sql",
      mirrorFile: "20260905010000_durable_learning_tasks.sql",
      sha256: "2a18cd2f37287becc00b1b68c9696980adf0248e841fe82e9fbeff9240c2d066",
    },
    {
      apiFile: "0025-practice-workspace.sql",
      mirrorFile: "20260905020000_practice_workspace.sql",
      sha256: "78cff038d244a58c84664fde3e1e9c81c7cde3cfd37a043cfdb7c785788b997a",
    },
    {
      apiFile: "0026-email-first-password-signup.sql",
      mirrorFile: "20260907010000_email_first_password_signup.sql",
      sha256: "ac6360d461fbb32a026015ba676283cdc16f36b9a3a83863ea4b348c60e03285",
    },
    {
      apiFile: "0027-error-diagnostics.sql",
      mirrorFile: "20260907020000_error_diagnostics.sql",
      sha256: "517bf3821ec3037117ea96f7505c3ef6d956e0fb17b5b622ba502fcf3b12797d",
    },
    {
      apiFile: "0028-password-recovery-correctable-retry.sql",
      mirrorFile: "20260907030000_password_recovery_correctable_retry.sql",
      sha256: "f8b5f9e7169ca3badc25d3f7bdb905e3a02fa9e07dfae21075c4fb4b6758bee6",
    },
  ].map((entry) => Object.freeze(entry)),
);

export function assertHostedCombinedMigrationSources(sources) {
  if (
    sources?.migrations?.length !== 28 ||
    createHash("sha256")
      .update(sources?.seed ?? "")
      .digest("hex") !== "c9281f541e21f7c59c90bec11f19a0a03ffdf05789ed547bdc9fbc855c2bd6ef"
  ) {
    throw new Error("Hosted combined migration sources are invalid.");
  }
  for (const [index, migration] of sources.migrations.entries()) {
    if (
      migration.version !== hostedCombinedMigrationArtifactContract.migrationVersions[index] ||
      createHash("sha256").update(migration.source).digest("hex") !==
        hostedCombinedMigrationSourcePins[index].sha256
    ) {
      throw new Error("Hosted combined migration sources are invalid.");
    }
  }
}

export async function loadHostedCombinedMigrationSources(repositoryRoot) {
  const sources = await loadHostedImportantBatchRebuildSources(
    repositoryRoot,
    hostedCombinedMigrationArtifactContract,
  );
  assertHostedCombinedMigrationSources(sources);
  for (const [directory, key] of [
    ["supabase/migrations", "mirrorFile"],
    ["apps/api/migrations", "apiFile"],
  ]) {
    const expectedFiles = hostedCombinedMigrationSourcePins.map((pin) => pin[key]).sort();
    if (
      JSON.stringify((await readdir(join(repositoryRoot, directory))).sort()) !==
      JSON.stringify(expectedFiles)
    ) {
      throw new Error("Hosted combined migration source set is invalid.");
    }
    for (const pin of hostedCombinedMigrationSourcePins) {
      const path = join(repositoryRoot, directory, pin[key]);
      const stats = await lstat(path);
      if (
        !stats.isFile() ||
        stats.size < 1 ||
        stats.size > 1_048_576 ||
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex") !== pin.sha256
      ) {
        throw new Error("Hosted combined migration mirror is invalid.");
      }
    }
  }
  return sources;
}
